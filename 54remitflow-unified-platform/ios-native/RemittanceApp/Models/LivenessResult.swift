import Foundation

struct LivenessResult: Decodable {
    let is_live: Bool
    let confidence_score: Float
}
