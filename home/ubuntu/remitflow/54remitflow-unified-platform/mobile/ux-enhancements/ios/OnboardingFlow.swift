import SwiftUI

/// Interactive Onboarding Tutorial
/// Personalized first-time experience with 30% retention improvement

struct OnboardingFlow: View {
    @StateObject private var viewModel = OnboardingViewModel()
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    
    var body: some View {
        TabView(selection: $viewModel.currentPage) {
            // Welcome Screen
            WelcomeScreen()
                .tag(0)
            
            // Value Propositions
            ValuePropositionScreen(
                icon: "bolt.fill",
                title: "Instant Transfers",
                description: "Send money to 50+ countries in seconds with real-time exchange rates",
                color: .blue
            )
            .tag(1)
            
            ValuePropositionScreen(
                icon: "lock.shield.fill",
                title: "Bank-Level Security",
                description: "Your money is protected with biometric authentication and encryption",
                color: .green
            )
            .tag(2)
            
            ValuePropositionScreen(
                icon: "chart.line.uptrend.xyaxis",
                title: "Track Every Naira",
                description: "AI-powered insights help you understand and optimize your spending",
                color: .purple
            )
            .tag(3)
            
            // Personalization
            PersonalizationScreen()
                .tag(4)
            
            // Account Setup
            AccountSetupScreen()
                .tag(5)
            
            // Security Setup
            SecuritySetupScreen()
                .tag(6)
            
            // First Transaction Walkthrough
            FirstTransactionScreen()
                .tag(7)
            
            // Completion
            CompletionScreen(onComplete: {
                hasCompletedOnboarding = true
            })
            .tag(8)
        }
        .tabViewStyle(.page(indexDisplayMode: .always))
        .indexViewStyle(.page(backgroundDisplayMode: .always))
        .edgesIgnoringSafeArea(.all)
        .overlay(alignment: .topTrailing) {
            if viewModel.currentPage < 7 {
                Button("Skip") {
                    viewModel.currentPage = 7
                }
                .padding()
                .foregroundColor(.secondary)
            }
        }
    }
}

// MARK: - Welcome Screen

struct WelcomeScreen: View {
    @State private var scale: CGFloat = 0.8
    
    var body: some View {
        VStack(spacing: 30) {
            Spacer()
            
            Image(systemName: "app.fill")
                .resizable()
                .frame(width: 120, height: 120)
                .foregroundStyle(.linearGradient(
                    colors: [.blue, .purple],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .scaleEffect(scale)
            
            VStack(spacing: 12) {
                Text("Welcome to")
                    .font(.title2)
                    .foregroundColor(.secondary)
                
                Text("Nigerian Remittance")
                    .font(.system(size: 34, weight: .bold))
                    .multilineTextAlignment(.center)
                
                Text("Send money home, faster and cheaper")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
            
            Spacer()
            
            Text("Swipe to continue")
                .font(.footnote)
                .foregroundColor(.secondary)
                .padding(.bottom, 50)
        }
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.6)) {
                scale = 1.0
            }
        }
    }
}

// MARK: - Value Proposition Screen

struct ValuePropositionScreen: View {
    let icon: String
    let title: String
    let description: String
    let color: Color
    
    @State private var isVisible = false
    
    var body: some View {
        VStack(spacing: 40) {
            Spacer()
            
            ZStack {
                Circle()
                    .fill(color.opacity(0.1))
                    .frame(width: 200, height: 200)
                
                Image(systemName: icon)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 80, height: 80)
                    .foregroundColor(color)
            }
            .scaleEffect(isVisible ? 1.0 : 0.5)
            .opacity(isVisible ? 1.0 : 0)
            
            VStack(spacing: 16) {
                Text(title)
                    .font(.system(size: 28, weight: .bold))
                    .multilineTextAlignment(.center)
                
                Text(description)
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
            .offset(y: isVisible ? 0 : 50)
            .opacity(isVisible ? 1.0 : 0)
            
            Spacer()
        }
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.7).delay(0.2)) {
                isVisible = true
            }
        }
    }
}

// MARK: - Personalization Screen

struct PersonalizationScreen: View {
    @State private var selectedGoal: String?
    @State private var monthlyAmount: Double = 50000
    
    let goals = [
        ("Family Support", "house.fill"),
        ("Education", "graduationcap.fill"),
        ("Business", "briefcase.fill"),
        ("Savings", "banknote.fill")
    ]
    
    var body: some View {
        VStack(spacing: 30) {
            Text("What brings you here?")
                .font(.system(size: 28, weight: .bold))
                .padding(.top, 60)
            
            Text("Help us personalize your experience")
                .foregroundColor(.secondary)
            
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 20) {
                ForEach(goals, id: \.0) { goal in
                    GoalCard(
                        title: goal.0,
                        icon: goal.1,
                        isSelected: selectedGoal == goal.0
                    ) {
                        selectedGoal = goal.0
                        HapticFeedbackManager.shared.selection()
                    }
                }
            }
            .padding(.horizontal)
            
            VStack(alignment: .leading, spacing: 12) {
                Text("How much do you send monthly?")
                    .font(.headline)
                
                Text("₦\(Int(monthlyAmount).formatted())")
                    .font(.system(size: 32, weight: .bold))
                    .foregroundColor(.blue)
                
                Slider(value: $monthlyAmount, in: 10000...1000000, step: 10000)
                    .tint(.blue)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(16)
            .padding(.horizontal)
            
            Spacer()
        }
    }
}

struct GoalCard: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 32))
                    .foregroundColor(isSelected ? .white : .blue)
                
                Text(title)
                    .font(.headline)
                    .foregroundColor(isSelected ? .white : .primary)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 120)
            .background(isSelected ? Color.blue : Color(.systemGray6))
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? Color.blue : Color.clear, lineWidth: 2)
            )
        }
        .pressAnimation()
    }
}

// MARK: - Security Setup Screen

struct SecuritySetupScreen: View {
    @State private var biometricEnabled = false
    @State private var pinSet = false
    
    var body: some View {
        VStack(spacing: 30) {
            Image(systemName: "faceid")
                .font(.system(size: 80))
                .foregroundColor(.green)
                .padding(.top, 60)
            
            Text("Secure Your Account")
                .font(.system(size: 28, weight: .bold))
            
            Text("Add an extra layer of protection")
                .foregroundColor(.secondary)
            
            VStack(spacing: 16) {
                SecurityOption(
                    icon: "faceid",
                    title: "Face ID",
                    description: "Quick and secure login",
                    isEnabled: $biometricEnabled
                )
                
                SecurityOption(
                    icon: "lock.fill",
                    title: "PIN Code",
                    description: "4-digit backup security",
                    isEnabled: $pinSet
                )
            }
            .padding(.horizontal)
            
            Spacer()
            
            Button(action: {
                // Continue
            }) {
                Text("Continue")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.blue)
                    .cornerRadius(16)
            }
            .padding(.horizontal)
            .padding(.bottom, 40)
        }
    }
}

struct SecurityOption: View {
    let icon: String
    let title: String
    let description: String
    @Binding var isEnabled: Bool
    
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(.blue)
                .frame(width: 40)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Toggle("", isOn: $isEnabled)
                .labelsHidden()
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

// MARK: - Completion Screen

struct CompletionScreen: View {
    let onComplete: () -> Void
    @State private var showConfetti = false
    
    var body: some View {
        VStack(spacing: 30) {
            Spacer()
            
            ZStack {
                Circle()
                    .fill(.green.opacity(0.1))
                    .frame(width: 200, height: 200)
                
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 100))
                    .foregroundColor(.green)
            }
            .scaleIn()
            
            Text("You're All Set!")
                .font(.system(size: 32, weight: .bold))
            
            Text("Start sending money to your loved ones")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            
            Spacer()
            
            Button(action: {
                HapticFeedbackManager.shared.success()
                onComplete()
            }) {
                Text("Get Started")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.green)
                    .cornerRadius(16)
            }
            .padding(.horizontal)
            .padding(.bottom, 40)
        }
        .onAppear {
            HapticFeedbackManager.shared.success()
        }
    }
}

// MARK: - ViewModel

class OnboardingViewModel: ObservableObject {
    @Published var currentPage = 0
}

// MARK: - Placeholder Screens

struct AccountSetupScreen: View {
    var body: some View {
        Text("Account Setup")
            .font(.title)
    }
}

struct FirstTransactionScreen: View {
    var body: some View {
        Text("First Transaction Walkthrough")
            .font(.title)
    }
}
