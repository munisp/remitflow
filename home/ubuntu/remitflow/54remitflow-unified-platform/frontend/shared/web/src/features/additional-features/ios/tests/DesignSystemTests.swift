import XCTest
import UIKit

// NOTE: In a real project, you would import the module containing DesignSystem.swift
// For this task, we assume DesignSystem.swift is available in the test target.

// MARK: - Helper Extensions for Testing

extension UIColor {
    // Helper to compare two UIColors by converting them to RGBA components
    func isEqualToColor(_ color: UIColor, tolerance: CGFloat = 0.001) -> Bool {
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        
        self.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        color.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        
        return abs(r1 - r2) <= tolerance &&
               abs(g1 - g2) <= tolerance &&
               abs(b1 - b2) <= tolerance &&
               abs(a1 - a2) <= tolerance
    }
}

extension UIFont {
    // Helper to compare two UIFonts by name and size
    func isEqualToFont(_ font: UIFont) -> Bool {
        return self.fontName == font.fontName && self.pointSize == font.pointSize
    }
}

// MARK: - DesignSystemTests

final class DesignSystemTests: XCTestCase {

    // MARK: - Test Design Tokens

    func testColorTokens_shouldReturnCorrectValues() {
        // Arrange & Act
        let primary = DesignSystem.Color.primary
        let secondary = DesignSystem.Color.secondary
        let background = DesignSystem.Color.background
        let textPrimary = DesignSystem.Color.textPrimary
        let error = DesignSystem.Color.error

        // Assert
        XCTAssertTrue(primary.isEqualToColor(UIColor(red: 0.1, green: 0.4, blue: 0.9, alpha: 1.0)), "Primary color is incorrect")
        XCTAssertTrue(secondary.isEqualToColor(UIColor(red: 0.9, green: 0.5, blue: 0.1, alpha: 1.0)), "Secondary color is incorrect")
        XCTAssertTrue(background.isEqualToColor(UIColor.white), "Background color is incorrect")
        XCTAssertTrue(textPrimary.isEqualToColor(UIColor.black), "Text Primary color is incorrect")
        XCTAssertTrue(error.isEqualToColor(UIColor.red), "Error color is incorrect")
    }

    func testFontTokens_shouldReturnCorrectFontsAndWeights() {
        // Test Headline
        let headlineDefault = DesignSystem.Font.headline()
        let headlineLight = DesignSystem.Font.headline(weight: .light)
        XCTAssertEqual(headlineDefault.pointSize, 24, "Headline font size is incorrect")
        XCTAssertTrue(headlineDefault.fontDescriptor.symbolicTraits.contains(.traitBold), "Headline default weight should be bold")
        XCTAssertFalse(headlineLight.fontDescriptor.symbolicTraits.contains(.traitBold), "Headline light weight should not be bold")

        // Test Body
        let bodyDefault = DesignSystem.Font.body()
        let bodySemibold = DesignSystem.Font.body(weight: .semibold)
        XCTAssertEqual(bodyDefault.pointSize, 16, "Body font size is incorrect")
        XCTAssertTrue(bodyDefault.fontDescriptor.symbolicTraits.contains(.traitUIFontWeightRegular), "Body default weight should be regular")
        XCTAssertTrue(bodySemibold.fontDescriptor.symbolicTraits.contains(.traitUIFontWeightSemibold), "Body semibold weight is incorrect")

        // Test Caption
        let captionDefault = DesignSystem.Font.caption()
        XCTAssertEqual(captionDefault.pointSize, 12, "Caption font size is incorrect")
        XCTAssertTrue(captionDefault.fontDescriptor.symbolicTraits.contains(.traitUIFontWeightLight), "Caption default weight should be light")
    }

    func testSpacingTokens_shouldReturnCorrectValues() {
        // Assert
        XCTAssertEqual(DesignSystem.Spacing.small, 4.0, accuracy: 0.001, "Small spacing is incorrect")
        XCTAssertEqual(DesignSystem.Spacing.medium, 8.0, accuracy: 0.001, "Medium spacing is incorrect")
        XCTAssertEqual(DesignSystem.Spacing.large, 16.0, accuracy: 0.001, "Large spacing is incorrect")
        XCTAssertEqual(DesignSystem.Spacing.xLarge, 32.0, accuracy: 0.001, "XLarge spacing is incorrect")
    }

    // MARK: - Test Custom Component (DSLabel)

    func testDSLabel_defaultInitializer_shouldApplyBodyStyle() {
        // Arrange & Act
        let label = DSLabel()

        // Assert
        XCTAssertEqual(label.style, .body, "Default style should be .body")
        XCTAssertTrue(label.font.isEqualToFont(DesignSystem.Font.body()), "Default font should be body font")
        XCTAssertTrue(label.textColor.isEqualToColor(DesignSystem.Color.textPrimary), "Default text color is incorrect")
        XCTAssertEqual(label.accessibilityTraits, .staticText, "Default accessibility trait is incorrect")
    }

    func testDSLabel_styleInitializer_shouldApplyCorrectStyle() {
        // Arrange & Act
        let label = DSLabel(style: .headline)

        // Assert
        XCTAssertEqual(label.style, .headline, "Initialized style should be .headline")
        XCTAssertTrue(label.font.isEqualToFont(DesignSystem.Font.headline()), "Headline font should be applied")
        XCTAssertEqual(label.accessibilityTraits, .header, "Headline accessibility trait is incorrect")
    }

    func testDSLabel_setStyleProperty_shouldUpdateStyle() {
        // Arrange
        let label = DSLabel(style: .headline)

        // Act
        label.style = .caption

        // Assert
        XCTAssertEqual(label.style, .caption, "Style property update failed")
        XCTAssertTrue(label.font.isEqualToFont(DesignSystem.Font.caption()), "Caption font should be applied after update")
        XCTAssertTrue(label.textColor.isEqualToColor(DesignSystem.Color.textPrimary.withAlphaComponent(0.7), tolerance: 0.01), "Caption text color alpha is incorrect")
        XCTAssertEqual(label.accessibilityTraits, .staticText, "Caption accessibility trait is incorrect")
    }
    
    func testDSLabel_coderInitializer_shouldApplyBodyStyle() throws {
        // Arrange
        let label = DSLabel()
        let data = try NSKeyedArchiver.archivedData(withRootObject: label, requiringSecureCoding: false)
        
        // Act
        let decodedLabel = try XCTUnwrap(NSKeyedUnarchiver.unarchiveObject(with: data) as? DSLabel)
        
        // Assert
        XCTAssertEqual(decodedLabel.style, .body, "Decoded label should have default .body style")
        XCTAssertTrue(decodedLabel.font.isEqualToFont(DesignSystem.Font.body()), "Decoded label should have body font")
    }

    // MARK: - Test UIButton Extension

    func testUIButton_applyPrimaryStyle_shouldSetCorrectProperties() {
        // Arrange
        let button = UIButton(type: .system)
        button.setTitle("Submit", for: .normal)

        // Act
        button.applyPrimaryStyle()

        // Assert
        XCTAssertTrue(button.backgroundColor?.isEqualToColor(DesignSystem.Color.primary) ?? false, "Primary style background color is incorrect")
        XCTAssertTrue(button.titleColor(for: .normal)?.isEqualToColor(DesignSystem.Color.background) ?? false, "Primary style title color is incorrect")
        XCTAssertEqual(button.layer.cornerRadius, DesignSystem.Spacing.medium, "Primary style corner radius is incorrect")
        XCTAssertTrue(button.titleLabel?.font.isEqualToFont(DesignSystem.Font.body(weight: .semibold)) ?? false, "Primary style font is incorrect")
        XCTAssertEqual(button.accessibilityLabel, "Submit", "Primary style accessibility label is incorrect")
        XCTAssertEqual(button.accessibilityHint, "Activates the primary action.", "Primary style accessibility hint is incorrect")
    }

    func testUIButton_applyDestructiveStyle_shouldSetCorrectProperties() {
        // Arrange
        let button = UIButton(type: .system)
        button.setTitle("Delete", for: .normal)

        // Act
        button.applyDestructiveStyle()

        // Assert
        XCTAssertTrue(button.backgroundColor?.isEqualToColor(DesignSystem.Color.error) ?? false, "Destructive style background color is incorrect")
        XCTAssertTrue(button.titleColor(for: .normal)?.isEqualToColor(DesignSystem.Color.background) ?? false, "Destructive style title color is incorrect")
        XCTAssertEqual(button.layer.cornerRadius, DesignSystem.Spacing.medium, "Destructive style corner radius is incorrect")
        XCTAssertTrue(button.titleLabel?.font.isEqualToFont(DesignSystem.Font.body(weight: .semibold)) ?? false, "Destructive style font is incorrect")
        XCTAssertEqual(button.accessibilityLabel, "Delete", "Destructive style accessibility label is incorrect")
        XCTAssertEqual(button.accessibilityHint, "Activates the destructive action.", "Destructive style accessibility hint is incorrect")
    }

    // MARK: - Test UITextField Extension

    func testUITextField_applyStandardStyle_shouldSetCorrectProperties() {
        // Arrange
        let textField = UITextField()

        // Act
        textField.applyStandardStyle()

        // Assert
        XCTAssertEqual(textField.borderStyle, .roundedRect, "Standard style border style is incorrect")
        XCTAssertTrue(textField.font?.isEqualToFont(DesignSystem.Font.body()) ?? false, "Standard style font is incorrect")
        XCTAssertTrue(textField.textColor?.isEqualToColor(DesignSystem.Color.textPrimary) ?? false, "Standard style text color is incorrect")
        XCTAssertEqual(textField.layer.borderWidth, 1.0, accuracy: 0.001, "Standard style border width is incorrect")
        XCTAssertEqual(textField.layer.cornerRadius, DesignSystem.Spacing.small, "Standard style corner radius is incorrect")
        XCTAssertEqual(textField.accessibilityTraits, .none, "Standard style accessibility trait is incorrect")
        
        // Edge case: Check border color (CGColor comparison is tricky, check for non-nil and approximate color)
        let secondaryCGColor = DesignSystem.Color.secondary.cgColor
        XCTAssertEqual(textField.layer.borderColor, secondaryCGColor, "Standard style border color is incorrect")
    }

    func testUITextField_setPlaceholder_shouldSetAttributedPlaceholder() {
        // Arrange
        let textField = UITextField()
        let placeholderText = "Enter text here"
        let expectedColor = DesignSystem.Color.textPrimary.withAlphaComponent(0.5)
        let expectedFont = DesignSystem.Font.body(weight: .light)

        // Act
        textField.setPlaceholder(text: placeholderText)

        // Assert
        let attributedPlaceholder = textField.attributedPlaceholder
        XCTAssertNotNil(attributedPlaceholder, "Attributed placeholder should not be nil")
        XCTAssertEqual(attributedPlaceholder?.string, placeholderText, "Placeholder text is incorrect")

        let attributes = attributedPlaceholder?.attributes(at: 0, effectiveRange: nil)
        XCTAssertNotNil(attributes, "Placeholder attributes should not be nil")

        let actualColor = attributes?[.foregroundColor] as? UIColor
        let actualFont = attributes?[.font] as? UIFont

        XCTAssertTrue(actualColor?.isEqualToColor(expectedColor) ?? false, "Placeholder color is incorrect")
        XCTAssertTrue(actualFont?.isEqualToFont(expectedFont) ?? false, "Placeholder font is incorrect")
        
        // Edge case: Test with custom color
        let customColor = UIColor.blue
        textField.setPlaceholder(text: placeholderText, color: customColor)
        let customAttributes = textField.attributedPlaceholder?.attributes(at: 0, effectiveRange: nil)
        let actualCustomColor = customAttributes?[.foregroundColor] as? UIColor
        XCTAssertTrue(actualCustomColor?.isEqualToColor(customColor) ?? false, "Custom placeholder color is incorrect")
    }
    
    // MARK: - Test Accessibility Helper (UIView Extension)
    
    func testUIView_setAccessibility_shouldSetCorrectProperties() {
        // Arrange
        let view = UIView()
        let label = "My View"
        let hint = "This is a view"
        
        // Act 1: Full properties
        view.setAccessibility(label: label, hint: hint, isElement: true)
        
        // Assert 1
        XCTAssertTrue(view.isAccessibilityElement, "isAccessibilityElement should be true")
        XCTAssertEqual(view.accessibilityLabel, label, "Accessibility label is incorrect")
        XCTAssertEqual(view.accessibilityHint, hint, "Accessibility hint is incorrect")
        
        // Act 2: Default properties (hint is nil, isElement is true)
        view.setAccessibility(label: label)
        
        // Assert 2
        XCTAssertTrue(view.isAccessibilityElement, "isAccessibilityElement should be true (default)")
        XCTAssertEqual(view.accessibilityLabel, label, "Accessibility label is incorrect")
        XCTAssertNil(view.accessibilityHint, "Accessibility hint should be nil when not provided")
        
        // Act 3: isElement is false
        view.setAccessibility(label: label, isElement: false)
        
        // Assert 3
        XCTAssertFalse(view.isAccessibilityElement, "isAccessibilityElement should be false")
    }
}