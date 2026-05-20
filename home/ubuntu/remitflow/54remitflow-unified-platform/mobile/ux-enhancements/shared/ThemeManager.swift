import SwiftUI
import Combine

/// Dark Mode with Auto-Switching
/// System-aware theming with manual override and smooth transitions

class ThemeManager: ObservableObject {
    static let shared = ThemeManager()
    
    @Published var currentTheme: Theme = .system
    @Published var isDarkMode: Bool = false
    
    @AppStorage("selectedTheme") private var storedTheme: String = "system"
    
    private init() {
        loadTheme()
        observeSystemTheme()
    }
    
    enum Theme: String, CaseIterable {
        case light = "Light"
        case dark = "Dark"
        case system = "System"
        
        var icon: String {
            switch self {
            case .light: return "sun.max.fill"
            case .dark: return "moon.fill"
            case .system: return "circle.lefthalf.filled"
            }
        }
    }
    
    func setTheme(_ theme: Theme) {
        withAnimation(.smooth) {
            currentTheme = theme
            storedTheme = theme.rawValue
            updateDarkMode()
        }
    }
    
    private func loadTheme() {
        if let theme = Theme(rawValue: storedTheme) {
            currentTheme = theme
        }
        updateDarkMode()
    }
    
    private func observeSystemTheme() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(systemThemeChanged),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }
    
    @objc private func systemThemeChanged() {
        updateDarkMode()
    }
    
    private func updateDarkMode() {
        switch currentTheme {
        case .light:
            isDarkMode = false
        case .dark:
            isDarkMode = true
        case .system:
            isDarkMode = UITraitCollection.current.userInterfaceStyle == .dark
        }
    }
}

// MARK: - Color Palette

extension Color {
    // Light Mode Colors
    static let lightBackground = Color(hex: "FFFFFF")
    static let lightSecondaryBackground = Color(hex: "F5F5F5")
    static let lightTertiaryBackground = Color(hex: "EBEBEB")
    static let lightPrimaryText = Color(hex: "000000")
    static let lightSecondaryText = Color(hex: "666666")
    
    // Dark Mode Colors
    static let darkBackground = Color(hex: "000000")
    static let darkSecondaryBackground = Color(hex: "1C1C1E")
    static let darkTertiaryBackground = Color(hex: "2C2C2E")
    static let darkPrimaryText = Color(hex: "FFFFFF")
    static let darkSecondaryText = Color(hex: "EBEBF5")
    
    // Adaptive Colors
    static func adaptiveBackground(_ isDark: Bool) -> Color {
        isDark ? darkBackground : lightBackground
    }
    
    static func adaptiveSecondaryBackground(_ isDark: Bool) -> Color {
        isDark ? darkSecondaryBackground : lightSecondaryBackground
    }
    
    static func adaptiveTertiaryBackground(_ isDark: Bool) -> Color {
        isDark ? darkTertiaryBackground : lightTertiaryBackground
    }
    
    static func adaptivePrimaryText(_ isDark: Bool) -> Color {
        isDark ? darkPrimaryText : lightPrimaryText
    }
    
    static func adaptiveSecondaryText(_ isDark: Bool) -> Color {
        isDark ? darkSecondaryText : lightSecondaryText
    }
    
    // Hex initializer
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Theme Picker View

struct ThemePicker: View {
    @ObservedObject var themeManager = ThemeManager.shared
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Appearance")
                .font(.title2.bold())
                .frame(maxWidth: .infinity, alignment: .leading)
            
            HStack(spacing: 16) {
                ForEach(ThemeManager.Theme.allCases, id: \.self) { theme in
                    ThemeOption(
                        theme: theme,
                        isSelected: themeManager.currentTheme == theme
                    ) {
                        themeManager.setTheme(theme)
                        HapticFeedbackManager.shared.selection()
                    }
                }
            }
        }
        .padding()
    }
}

struct ThemeOption: View {
    let theme: ThemeManager.Theme
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(isSelected ? Color.blue : Color.gray.opacity(0.2))
                        .frame(width: 60, height: 60)
                    
                    Image(systemName: theme.icon)
                        .font(.title2)
                        .foregroundColor(isSelected ? .white : .gray)
                }
                
                Text(theme.rawValue)
                    .font(.caption)
                    .foregroundColor(isSelected ? .blue : .gray)
            }
        }
        .pressAnimation()
    }
}

// MARK: - Environment Key

struct ThemeKey: EnvironmentKey {
    static let defaultValue: Bool = false
}

extension EnvironmentValues {
    var isDarkMode: Bool {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

// MARK: - View Extension

extension View {
    func themedBackground(_ isDark: Bool) -> some View {
        self.background(Color.adaptiveBackground(isDark))
    }
    
    func themedForeground(_ isDark: Bool) -> some View {
        self.foregroundColor(Color.adaptivePrimaryText(isDark))
    }
}
