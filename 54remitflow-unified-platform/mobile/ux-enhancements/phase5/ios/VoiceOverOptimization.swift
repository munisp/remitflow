import SwiftUI

/// VoiceOver Optimization Extensions
extension View {
    func accessibilityLabel(_ label: String, hint: String? = nil) -> some View {
        self
            .accessibilityLabel(Text(label))
            .accessibilityHint(hint != nil ? Text(hint!) : Text(""))
    }
    
    func accessibilityValue(_ value: String) -> some View {
        self.accessibilityValue(Text(value))
    }
    
    func accessibilityAction(named name: String, action: @escaping () -> Void) -> some View {
        self.accessibilityAction(named: Text(name), action)
    }
}

// MARK: - Accessible Components

struct AccessibleButton: View {
    let title: String
    let icon: String?
    let action: () -> Void
    let hint: String?
    
    init(_ title: String, icon: String? = nil, hint: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.hint = hint
        self.action = action
    }
    
    var body: some View {
        Button(action: action) {
            HStack {
                if let icon = icon {
                    Image(systemName: icon)
                }
                Text(title)
            }
        }
        .accessibilityLabel(title)
        .accessibilityHint(hint ?? "")
        .accessibilityAddTraits(.isButton)
    }
}

struct AccessibleTextField: View {
    let label: String
    @Binding var text: String
    let hint: String?
    
    init(_ label: String, text: Binding<String>, hint: String? = nil) {
        self.label = label
        self._text = text
        self.hint = hint
    }
    
    var body: some View {
        TextField(label, text: $text)
            .accessibilityLabel(label)
            .accessibilityValue(text.isEmpty ? "Empty" : text)
            .accessibilityHint(hint ?? "")
    }
}
