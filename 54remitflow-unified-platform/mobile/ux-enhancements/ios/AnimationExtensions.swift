import SwiftUI

/// Revolut-style Micro-Animations and Transitions
/// Provides fluid, purposeful animations that make the app feel premium

// MARK: - Animation Presets

extension Animation {
    /// Smooth spring animation for general use
    static let smooth = Animation.spring(response: 0.3, dampingFraction: 0.7)
    
    /// Bouncy animation for playful interactions
    static let bouncy = Animation.spring(response: 0.4, dampingFraction: 0.6)
    
    /// Quick animation for instant feedback
    static let quick = Animation.easeOut(duration: 0.2)
    
    /// Slow animation for dramatic effects
    static let slow = Animation.easeInOut(duration: 0.5)
}

// MARK: - Fade Transitions

extension View {
    /// Fade in effect for content appearance
    func fadeIn(duration: Double = 0.3, delay: Double = 0) -> some View {
        self.modifier(FadeInModifier(duration: duration, delay: delay))
    }
    
    /// Fade out effect for content disappearance
    func fadeOut(duration: Double = 0.3) -> some View {
        self.opacity(0)
            .animation(.easeOut(duration: duration), value: UUID())
    }
}

struct FadeInModifier: ViewModifier {
    let duration: Double
    let delay: Double
    @State private var opacity: Double = 0
    
    func body(content: Content) -> some View {
        content
            .opacity(opacity)
            .onAppear {
                withAnimation(.easeIn(duration: duration).delay(delay)) {
                    opacity = 1
                }
            }
    }
}

// MARK: - Slide Transitions

extension View {
    /// Slide up transition for modals
    func slideUp(isPresented: Binding<Bool>) -> some View {
        self.modifier(SlideUpModifier(isPresented: isPresented))
    }
    
    /// Slide from edge
    func slideFromEdge(_ edge: Edge, distance: CGFloat = 300) -> some View {
        self.modifier(SlideFromEdgeModifier(edge: edge, distance: distance))
    }
}

struct SlideUpModifier: ViewModifier {
    @Binding var isPresented: Bool
    
    func body(content: Content) -> some View {
        content
            .offset(y: isPresented ? 0 : 500)
            .opacity(isPresented ? 1 : 0)
            .animation(.smooth, value: isPresented)
    }
}

struct SlideFromEdgeModifier: ViewModifier {
    let edge: Edge
    let distance: CGFloat
    @State private var offset: CGFloat = 0
    
    func body(content: Content) -> some View {
        content
            .offset(
                x: edge == .leading ? offset : (edge == .trailing ? -offset : 0),
                y: edge == .top ? offset : (edge == .bottom ? -offset : 0)
            )
            .onAppear {
                offset = distance
                withAnimation(.smooth) {
                    offset = 0
                }
            }
    }
}

// MARK: - Scale Animations

extension View {
    /// Scale in animation for buttons and cards
    func scaleIn(duration: Double = 0.3) -> some View {
        self.modifier(ScaleInModifier(duration: duration))
    }
    
    /// Press animation for interactive elements
    func pressAnimation() -> some View {
        self.modifier(PressAnimationModifier())
    }
}

struct ScaleInModifier: ViewModifier {
    let duration: Double
    @State private var scale: CGFloat = 0.8
    
    func body(content: Content) -> some View {
        content
            .scaleEffect(scale)
            .opacity(scale)
            .onAppear {
                withAnimation(.spring(response: duration, dampingFraction: 0.6)) {
                    scale = 1.0
                }
            }
    }
}

struct PressAnimationModifier: ViewModifier {
    @State private var isPressed = false
    
    func body(content: Content) -> some View {
        content
            .scaleEffect(isPressed ? 0.95 : 1.0)
            .opacity(isPressed ? 0.8 : 1.0)
            .animation(.quick, value: isPressed)
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in isPressed = true }
                    .onEnded { _ in isPressed = false }
            )
    }
}

// MARK: - Card Flip Animation

extension View {
    /// Card flip animation for transactions
    func cardFlip(isFlipped: Binding<Bool>) -> some View {
        self.modifier(CardFlipModifier(isFlipped: isFlipped))
    }
}

struct CardFlipModifier: ViewModifier {
    @Binding var isFlipped: Bool
    
    func body(content: Content) -> some View {
        content
            .rotation3DEffect(
                .degrees(isFlipped ? 180 : 0),
                axis: (x: 0, y: 1, z: 0)
            )
            .animation(.smooth, value: isFlipped)
    }
}

// MARK: - Number Count-Up Animation

struct AnimatedNumber: View {
    let value: Double
    let format: String
    @State private var displayValue: Double = 0
    
    var body: some View {
        Text(String(format: format, displayValue))
            .onAppear {
                animateNumber()
            }
            .onChange(of: value) { _ in
                animateNumber()
            }
    }
    
    private func animateNumber() {
        let steps = 30
        let increment = (value - displayValue) / Double(steps)
        
        for i in 0...steps {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.02) {
                displayValue += increment
                if i == steps {
                    displayValue = value // Ensure final value is exact
                }
            }
        }
    }
}

// MARK: - Shimmer Effect

extension View {
    /// Shimmer loading animation
    func shimmer() -> some View {
        self.modifier(ShimmerModifier())
    }
}

struct ShimmerModifier: ViewModifier {
    @State private var phase: CGFloat = 0
    
    func body(content: Content) -> some View {
        content
            .overlay(
                LinearGradient(
                    gradient: Gradient(colors: [.clear, .white.opacity(0.3), .clear]),
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .offset(x: phase)
                .mask(content)
            )
            .onAppear {
                withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                    phase = 300
                }
            }
    }
}

// MARK: - Pulse Animation

extension View {
    /// Pulse animation for notifications
    func pulse(scale: CGFloat = 1.1) -> some View {
        self.modifier(PulseModifier(scale: scale))
    }
}

struct PulseModifier: ViewModifier {
    let scale: CGFloat
    @State private var isPulsing = false
    
    func body(content: Content) -> some View {
        content
            .scaleEffect(isPulsing ? scale : 1.0)
            .opacity(isPulsing ? 0.7 : 1.0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                    isPulsing = true
                }
            }
    }
}

// MARK: - Shake Animation

extension View {
    /// Shake animation for errors
    func shake(trigger: Int) -> some View {
        self.modifier(ShakeModifier(shakes: trigger))
    }
}

struct ShakeModifier: ViewModifier {
    let shakes: Int
    @State private var offset: CGFloat = 0
    
    func body(content: Content) -> some View {
        content
            .offset(x: offset)
            .onChange(of: shakes) { _ in
                performShake()
            }
    }
    
    private func performShake() {
        let animation = Animation.easeInOut(duration: 0.1)
        withAnimation(animation) {
            offset = 10
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            withAnimation(animation) {
                offset = -10
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            withAnimation(animation) {
                offset = 5
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            withAnimation(animation) {
                offset = 0
            }
        }
    }
}
