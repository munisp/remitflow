import SwiftUI
import Combine

@MainActor
class LivenessViewModel: ObservableObject {
    @Published var livenessState: LivenessState = .idle

    private var apiClient = APIClient.shared
    private var cancellables = Set<AnyCancellable>()

    func checkLiveness(selfieImage: UIImage) {
        livenessState = .loading

        guard let imageData = selfieImage.jpegData(compressionQuality: 0.8) else {
            livenessState = .error("Failed to convert image to data.")
            return
        }

        Task {
            do {
                let result: LivenessResult = try await apiClient.upload(
                    .checkLiveness,
                    data: imageData,
                    fileName: "selfie.jpg",
                    mimeType: "image/jpeg"
                )

                if result.is_live {
                    livenessState = .success(isLive: result.is_live, confidence: result.confidence_score)
                } else {
                    livenessState = .error("Liveness check failed. Please try again.")
                }
            } catch {
                livenessState = .error(error.localizedDescription)
            }
        }
    }
}

enum LivenessState {
    case idle
    case loading
    case success(isLive: Bool, confidence: Float)
    case error(String)
}
