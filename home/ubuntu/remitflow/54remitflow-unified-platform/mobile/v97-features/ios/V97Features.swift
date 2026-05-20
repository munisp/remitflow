import SwiftUI
import Combine

// ─── V97 Models ───────────────────────────────────────────────────────────────

struct VelocityRule: Codable, Identifiable {
    let id: Int
    let name: String
    let maxAmount: Double
    let windowHours: Int
    let action: String // "block" | "flag" | "review"
    let enabled: Bool
}

struct KycLifecycleState: Codable {
    let userId: Int
    let currentStage: String
    let completedAt: TimeInterval?
    let nextAction: String?
    let riskScore: Int
}

struct DocumentRenewal: Codable, Identifiable {
    let id: Int
    let documentType: String
    let expiresAt: TimeInterval
    let status: String
    let daysUntilExpiry: Int
}

struct WebhookDelivery: Codable, Identifiable {
    let id: Int
    let endpointUrl: String
    let eventType: String
    let status: String
    let attempts: Int
    let lastAttemptAt: TimeInterval?
    let nextRetryAt: TimeInterval?
}

struct ApiKeyInfo: Codable, Identifiable {
    let id: Int
    let name: String
    let prefix: String
    let scopes: [String]
    let lastUsedAt: TimeInterval?
    let expiresAt: TimeInterval?
    let isActive: Bool
}

struct BatchPaymentSummary: Codable, Identifiable {
    let id: Int
    let name: String
    let totalItems: Int
    let successCount: Int
    let failedCount: Int
    let pendingCount: Int
    let status: String
    let createdAt: TimeInterval
}

// ─── V97 ViewModel ────────────────────────────────────────────────────────────

@MainActor
class V97ViewModel: ObservableObject {
    @Published var velocityRules: [VelocityRule] = []
    @Published var kycLifecycle: KycLifecycleState?
    @Published var documentRenewals: [DocumentRenewal] = []
    @Published var failedWebhooks: [WebhookDelivery] = []
    @Published var apiKeys: [ApiKeyInfo] = []
    @Published var batchPayments: [BatchPaymentSummary] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let baseURL = "https://remitflow.manus.space"
    private var cancellables = Set<AnyCancellable>()

    init() {
        Task { await loadAll() }
    }

    func loadAll() async {
        isLoading = true
        defer { isLoading = false }
        async let rules = fetchVelocityRules()
        async let lifecycle = fetchKycLifecycle()
        async let renewals = fetchDocumentRenewals()
        async let webhooks = fetchFailedWebhooks()
        async let keys = fetchApiKeys()
        async let batches = fetchBatchPayments()
        velocityRules = (try? await rules) ?? []
        kycLifecycle = try? await lifecycle
        documentRenewals = (try? await renewals) ?? []
        failedWebhooks = (try? await webhooks) ?? []
        apiKeys = (try? await keys) ?? []
        batchPayments = (try? await batches) ?? []
    }

    private func fetchVelocityRules() async throws -> [VelocityRule] {
        try await fetch("/api/trpc/velocityChecks.list")
    }

    private func fetchKycLifecycle() async throws -> KycLifecycleState {
        try await fetch("/api/trpc/kycLifecycle.getMyLifecycle")
    }

    private func fetchDocumentRenewals() async throws -> [DocumentRenewal] {
        try await fetch("/api/trpc/documentVaultRenewal.listMyRenewals")
    }

    private func fetchFailedWebhooks() async throws -> [WebhookDelivery] {
        try await fetch("/api/trpc/webhookRetry.getFailedDeliveries")
    }

    private func fetchApiKeys() async throws -> [ApiKeyInfo] {
        try await fetch("/api/trpc/apiKeyRotation.list")
    }

    private func fetchBatchPayments() async throws -> [BatchPaymentSummary] {
        try await fetch("/api/trpc/batchPaymentV97.list")
    }

    func retryWebhook(deliveryId: Int) async {
        do {
            try await post("/api/trpc/webhookRetry.retryDelivery", body: ["deliveryId": deliveryId])
            failedWebhooks = (try? await fetchFailedWebhooks()) ?? []
        } catch { errorMessage = error.localizedDescription }
    }

    func rotateApiKey(keyId: Int) async {
        do {
            try await post("/api/trpc/apiKeyRotation.rotate", body: ["keyId": keyId])
            apiKeys = (try? await fetchApiKeys()) ?? []
        } catch { errorMessage = error.localizedDescription }
    }

    func retryFailedBatchItems(batchId: Int) async {
        do {
            try await post("/api/trpc/batchPaymentV97.retryFailed", body: ["batchId": batchId])
            batchPayments = (try? await fetchBatchPayments()) ?? []
        } catch { errorMessage = error.localizedDescription }
    }

    private func fetch<T: Decodable>(_ path: String) async throws -> T {
        guard let url = URL(string: baseURL + path) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post(_ path: String, body: [String: Any]) async throws {
        guard let url = URL(string: baseURL + path) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode < 400 else {
            throw URLError(.badServerResponse)
        }
    }
}

// ─── Velocity Check View ──────────────────────────────────────────────────────

struct VelocityCheckView: View {
    @StateObject private var viewModel = V97ViewModel()

    var body: some View {
        NavigationStack {
            List(viewModel.velocityRules) { rule in
                VelocityRuleRow(rule: rule)
            }
            .navigationTitle("Velocity Rules")
            .overlay {
                if viewModel.isLoading { ProgressView() }
            }
            .refreshable { await viewModel.loadAll() }
        }
    }
}

struct VelocityRuleRow: View {
    let rule: VelocityRule

    var actionColor: Color {
        switch rule.action {
        case "block": return .red
        case "flag": return .orange
        default: return .blue
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(rule.name).font(.headline)
                Spacer()
                Text(rule.action.uppercased())
                    .font(.caption.bold())
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(actionColor)
                    .clipShape(Capsule())
            }
            Text("Max: $\(rule.maxAmount, specifier: "%.0f") / \(rule.windowHours)h window")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Text(rule.enabled ? "Active" : "Disabled")
                .font(.caption)
                .foregroundColor(rule.enabled ? .green : .gray)
        }
        .padding(.vertical, 4)
    }
}

// ─── KYC Lifecycle View ───────────────────────────────────────────────────────

struct KycLifecycleView: View {
    @StateObject private var viewModel = V97ViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                if let lifecycle = viewModel.kycLifecycle {
                    VStack(spacing: 16) {
                        KycStageCard(lifecycle: lifecycle)
                        KycRiskScoreCard(riskScore: lifecycle.riskScore)
                        if let nextAction = lifecycle.nextAction {
                            KycNextActionCard(action: nextAction)
                        }
                    }
                    .padding()
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("KYC Lifecycle")
            .refreshable { await viewModel.loadAll() }
        }
    }
}

struct KycStageCard: View {
    let lifecycle: KycLifecycleState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Current Stage").font(.caption).foregroundColor(.secondary)
            Text(lifecycle.currentStage.uppercased())
                .font(.title2.bold())
                .foregroundColor(.blue)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 4)
    }
}

struct KycRiskScoreCard: View {
    let riskScore: Int

    var scoreColor: Color {
        switch riskScore {
        case 0..<30: return .green
        case 30..<70: return .orange
        default: return .red
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Risk Score").font(.caption).foregroundColor(.secondary)
            HStack {
                Text("\(riskScore)").font(.title.bold()).foregroundColor(scoreColor)
                Text("/ 100").font(.title3).foregroundColor(.secondary)
                Spacer()
                Gauge(value: Double(riskScore), in: 0...100) {}
                    .gaugeStyle(.accessoryCircularCapacity)
                    .tint(scoreColor)
                    .frame(width: 50, height: 50)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 4)
    }
}

struct KycNextActionCard: View {
    let action: String

    var body: some View {
        HStack {
            Image(systemName: "arrow.right.circle.fill")
                .foregroundColor(.blue)
            Text(action).font(.subheadline)
            Spacer()
        }
        .padding()
        .background(Color.blue.opacity(0.1))
        .cornerRadius(12)
    }
}

// ─── Document Renewal View ────────────────────────────────────────────────────

struct DocumentRenewalView: View {
    @StateObject private var viewModel = V97ViewModel()

    var body: some View {
        NavigationStack {
            List(viewModel.documentRenewals) { renewal in
                DocumentRenewalRow(renewal: renewal)
            }
            .navigationTitle("Document Renewals")
            .refreshable { await viewModel.loadAll() }
        }
    }
}

struct DocumentRenewalRow: View {
    let renewal: DocumentRenewal

    var urgencyColor: Color {
        switch renewal.daysUntilExpiry {
        case ..<7: return .red
        case ..<30: return .orange
        default: return .green
        }
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(renewal.documentType).font(.headline)
                Text("\(renewal.daysUntilExpiry) days until expiry")
                    .font(.subheadline)
                    .foregroundColor(urgencyColor)
            }
            Spacer()
            Text(renewal.status.uppercased())
                .font(.caption.bold())
                .foregroundColor(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(urgencyColor)
                .clipShape(Capsule())
        }
        .padding(.vertical, 4)
    }
}

// ─── Webhook Retry View ───────────────────────────────────────────────────────

struct WebhookRetryView: View {
    @StateObject private var viewModel = V97ViewModel()

    var body: some View {
        NavigationStack {
            List(viewModel.failedWebhooks) { delivery in
                WebhookDeliveryRow(delivery: delivery) {
                    Task { await viewModel.retryWebhook(deliveryId: delivery.id) }
                }
            }
            .navigationTitle("Failed Webhooks")
            .refreshable { await viewModel.loadAll() }
        }
    }
}

struct WebhookDeliveryRow: View {
    let delivery: WebhookDelivery
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(delivery.eventType).font(.headline)
            Text(delivery.endpointUrl)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(1)
            HStack {
                Text("Attempts: \(delivery.attempts)").font(.subheadline)
                Spacer()
                Button("Retry", action: onRetry)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }
}

// ─── API Key Management View ──────────────────────────────────────────────────

struct ApiKeyManagementView: View {
    @StateObject private var viewModel = V97ViewModel()
    @State private var keyToRotate: ApiKeyInfo?

    var body: some View {
        NavigationStack {
            List(viewModel.apiKeys) { key in
                ApiKeyRow(key: key) { keyToRotate = key }
            }
            .navigationTitle("API Keys")
            .refreshable { await viewModel.loadAll() }
            .confirmationDialog(
                "Rotate API Key",
                isPresented: Binding(
                    get: { keyToRotate != nil },
                    set: { if !$0 { keyToRotate = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Rotate Key", role: .destructive) {
                    if let key = keyToRotate {
                        Task { await viewModel.rotateApiKey(keyId: key.id) }
                    }
                    keyToRotate = nil
                }
                Button("Cancel", role: .cancel) { keyToRotate = nil }
            } message: {
                Text("This will invalidate the current key and generate a new one.")
            }
        }
    }
}

struct ApiKeyRow: View {
    let key: ApiKeyInfo
    let onRotate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(key.name).font(.headline)
                Spacer()
                Button("Rotate", action: onRotate)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
            Text("\(key.prefix)••••••••")
                .font(.system(.subheadline, design: .monospaced))
                .foregroundColor(.secondary)
            Text("Scopes: \(key.scopes.joined(separator: ", "))")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// ─── V97 Features Hub ─────────────────────────────────────────────────────────

struct V97FeaturesHub: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Compliance & Risk") {
                    NavigationLink("Velocity Rules", destination: VelocityCheckView())
                    NavigationLink("KYC Lifecycle", destination: KycLifecycleView())
                }
                Section("Documents") {
                    NavigationLink("Document Renewals", destination: DocumentRenewalView())
                }
                Section("Integrations") {
                    NavigationLink("Webhook Retry", destination: WebhookRetryView())
                    NavigationLink("API Keys", destination: ApiKeyManagementView())
                }
            }
            .navigationTitle("Advanced Features")
        }
    }
}

#Preview {
    V97FeaturesHub()
}
