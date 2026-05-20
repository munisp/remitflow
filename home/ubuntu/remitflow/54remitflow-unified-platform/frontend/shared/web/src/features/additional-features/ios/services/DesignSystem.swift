//
// DesignSystem.swift
//
// This file contains the unified design system for the application,
// including color, font, and spacing tokens, as well as extensions
// and custom components for a consistent user interface.
//
// Platform: iOS (UIKit)
//

import UIKit

// MARK: - 1. Design Tokens

/// A struct containing all application-wide color tokens.
/// All colors are defined as static properties for easy, type-safe access.
public struct DSColor {
    private init() {}

    // MARK: Primary Colors
    public static let primary = UIColor(red: 0.0, green: 0.478, blue: 1.0, alpha: 1.0) // #007AFF
    public static let primaryDark = UIColor(red: 0.0, green: 0.35, blue: 0.75, alpha: 1.0)
    public static let primaryLight = UIColor(red: 0.4, green: 0.65, blue: 1.0, alpha: 1.0)

    // MARK: Neutral Colors
    public static let background = UIColor.systemBackground
    public static let contentPrimary = UIColor.label
    public static let contentSecondary = UIColor.secondaryLabel
    public static let border = UIColor.separator
    public static let disabled = UIColor.systemGray3

    // MARK: Feedback Colors
    public static let success = UIColor(red: 0.2, green: 0.8, blue: 0.4, alpha: 1.0)
    public static let warning = UIColor(red: 1.0, green: 0.7, blue: 0.0, alpha: 1.0)
    public static let error = UIColor(red: 1.0, green: 0.23, blue: 0.19, alpha: 1.0) // #FF3B30
}

/// A struct containing all application-wide font tokens.
/// Fonts are defined using the system font with specified weights and sizes.
public struct DSFont {
    private init() {}

    /// Returns a font for large titles (e.g., navigation bar titles).
    public static func largeTitle(weight: UIFont.Weight = .bold) -> UIFont {
        return UIFont.systemFont(ofSize: 34, weight: weight)
    }

    /// Returns a font for main headings.
    public static func heading1(weight: UIFont.Weight = .semibold) -> UIFont {
        return UIFont.systemFont(ofSize: 28, weight: weight)
    }

    /// Returns a font for subheadings.
    public static func heading2(weight: UIFont.Weight = .medium) -> UIFont {
        return UIFont.systemFont(ofSize: 22, weight: weight)
    }

    /// Returns a font for body text.
    public static func body(weight: UIFont.Weight = .regular) -> UIFont {
        return UIFont.systemFont(ofSize: 17, weight: weight)
    }

    /// Returns a font for small, secondary text.
    public static func caption(weight: UIFont.Weight = .regular) -> UIFont {
        return UIFont.systemFont(ofSize: 12, weight: weight)
    }
}

/// A struct containing all application-wide spacing tokens.
/// Spacing values are defined as CGFloat for layout and constraints.
public struct DSSpacing {
    private init() {}

    public static let none: CGFloat = 0.0
    public static let xxs: CGFloat = 2.0
    public static let xs: CGFloat = 4.0
    public static let s: CGFloat = 8.0
    public static let m: CGFloat = 16.0 // Standard margin/padding
    public static let l: CGFloat = 24.0
    public static let xl: CGFloat = 32.0
    public static let xxl: CGFloat = 48.0
}

// MARK: - 2. Component Extensions

extension UIButton {
    /// Applies a standard primary style from the Design System to the button.
    /// - Parameter isFilled: If true, the button has a solid background; otherwise, it's a clear/outline style.
    public func applyPrimaryStyle(isFilled: Bool = true) {
        if isFilled {
            backgroundColor = DSColor.primary
            setTitleColor(.white, for: .normal)
            layer.cornerRadius = DSSpacing.s
            layer.borderWidth = 0
        } else {
            backgroundColor = .clear
            setTitleColor(DSColor.primary, for: .normal)
            layer.cornerRadius = DSSpacing.s
            layer.borderWidth = 1
            layer.borderColor = DSColor.primary.cgColor
        }
        titleLabel?.font = DSFont.body(weight: .semibold)
        contentEdgeInsets = UIEdgeInsets(top: DSSpacing.m, left: DSSpacing.l, bottom: DSSpacing.m, right: DSSpacing.l)
        
        // Add a simple state change for better UX
        addTarget(self, action: #selector(touchDown), for: .touchDown)
        addTarget(self, action: #selector(touchUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    }
    
    @objc private func touchDown() {
        self.alpha = 0.7
    }
    
    @objc private func touchUp() {
        UIView.animate(withDuration: 0.1) {
            self.alpha = 1.0
        }
    }
}

extension UITextField {
    /// Applies a standard text field style from the Design System.
    public func applyStandardStyle() {
        borderStyle = .roundedRect
        layer.cornerRadius = DSSpacing.xs
        layer.borderWidth = 1.0
        layer.borderColor = DSColor.border.cgColor
        font = DSFont.body()
        textColor = DSColor.contentPrimary
        
        // Add padding to the left and right of the text field
        let paddingView = UIView(frame: CGRect(x: 0, y: 0, width: DSSpacing.s, height: frame.height))
        leftView = paddingView
        leftViewMode = .always
        rightView = paddingView
        rightViewMode = .always
        
        // Placeholder text color
        if let placeholderText = placeholder {
            attributedPlaceholder = NSAttributedString(
                string: placeholderText,
                attributes: [.foregroundColor: DSColor.contentSecondary]
            )
        }
    }
}

// MARK: - 3. Custom Components

/// A custom button that can display a loading state with an activity indicator.
/// It integrates the Design System tokens and uses modern Swift concurrency.
public final class LoadingButton: UIButton {
    
    private let activityIndicator = UIActivityIndicatorView(style: .medium)
    private var originalTitle: String?
    private var isLoading: Bool = false {
        didSet {
            if isLoading {
                showLoadingState()
            } else {
                hideLoadingState()
            }
        }
    }
    
    // MARK: - Initialization
    
    public override init(frame: CGRect) {
        super.init(frame: frame)
        setupButton()
    }
    
    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupButton()
    }
    
    private func setupButton() {
        // Apply the standard primary style from the extension
        applyPrimaryStyle()
        
        // Setup Activity Indicator
        activityIndicator.hidesWhenStopped = true
        activityIndicator.color = .white // Assuming primary style is dark enough
        addSubview(activityIndicator)
        
        // Auto Layout for the indicator
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            activityIndicator.centerXAnchor.constraint(equalTo: centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }
    
    // MARK: - State Management
    
    private func showLoadingState() {
        originalTitle = title(for: .normal)
        setTitle("", for: .normal)
        activityIndicator.startAnimating()
        isEnabled = false
    }
    
    private func hideLoadingState() {
        activityIndicator.stopAnimating()
        setTitle(originalTitle, for: .normal)
        isEnabled = true
    }
    
    /// Simulates an asynchronous task, showing the loading state during execution.
    /// - Parameter task: The asynchronous closure to execute.
    public func performTask(task: @escaping () async throws -> Void) {
        guard !isLoading else { return }
        
        isLoading = true
        
        // Use Task for modern Swift concurrency
        Task {
            do {
                // Execute the user's task
                try await task()
                
                // Simulate a small delay to ensure the loading state is visible
                try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
                
            } catch {
                // Comprehensive error handling: Log the error and optionally show an alert
                print("LoadingButton Task Error: \(error.localizedDescription)")
                // In a real app, you would notify the user here (e.g., with a toast or alert)
            }
            
            // Ensure UI updates happen on the main thread
            await MainActor.run {
                self.isLoading = false
            }
        }
    }
}

// MARK: - 4. Utility

extension UIViewController {
    /// A convenience property to access the Design System's color tokens.
    public var dsColor: DSColor.Type {
        return DSColor.self
    }
    
    /// A convenience property to access the Design System's font tokens.
    public var dsFont: DSFont.Type {
        return DSFont.self
    }
    
    /// A convenience property to access the Design System's spacing tokens.
    public var dsSpacing: DSSpacing.Type {
        return DSSpacing.self
    }
    
    /// Presents a standard alert with a single "OK" action.
    /// - Parameters:
    ///   - title: The title of the alert.
    ///   - message: The message content of the alert.
    public func presentStandardAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        let okAction = UIAlertAction(title: "OK", style: .default)
        alert.addAction(okAction)
        present(alert, animated: true)
    }
}

// MARK: - 5. Custom View: CardView

/// A reusable view component for displaying content in a card-like format.
/// It applies design tokens for background, corner radius, and shadow.
public final class CardView: UIView {
    
    // MARK: - Initialization
    
    public override init(frame: CGRect) {
        super.init(frame: frame)
        setupCardView()
    }
    
    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupCardView()
    }
    
    private func setupCardView() {
        // Apply Design System tokens
        backgroundColor = DSColor.background
        layer.cornerRadius = DSSpacing.s
        
        // Apply a subtle shadow for depth
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.1
        layer.shadowOffset = CGSize(width: 0, height: 2)
        layer.shadowRadius = 4
        
        // Optimization for performance
        layer.shouldRasterize = true
        layer.rasterizationScale = UIScreen.main.scale
    }
    
    /// A container view to apply internal padding to the card's content.
    public lazy var contentView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        addSubview(view)
        
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: topAnchor, constant: DSSpacing.m),
            view.leadingAnchor.constraint(equalTo: leadingAnchor, constant: DSSpacing.m),
            view.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -DSSpacing.m),
            view.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -DSSpacing.m)
        ])
        return view
    }()
    
    // Override layoutSubviews to ensure shadow path is updated correctly
    public override func layoutSubviews() {
        super.layoutSubviews()
        // Update the shadow path to match the rounded corners
        layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: layer.cornerRadius).cgPath
    }
}

// MARK: - 6. UIStackView Utility

extension UIStackView {
    /// A convenience initializer that sets up a stack view with Design System spacing.
    /// - Parameters:
    ///   - axis: The axis along which the arranged views are laid out.
    ///   - spacing: The spacing to use, defaulting to `DSSpacing.m`.
    ///   - alignment: The alignment of the arranged views.
    ///   - distribution: The distribution of the arranged views.
    public convenience init(axis: NSLayoutConstraint.Axis, spacing: CGFloat = DSSpacing.m, alignment: UIStackView.Alignment = .fill, distribution: UIStackView.Distribution = .fill) {
        self.init()
        self.axis = axis
        self.spacing = spacing
        self.alignment = alignment
        self.distribution = distribution
        self.translatesAutoresizingMaskIntoConstraints = false
    }
}