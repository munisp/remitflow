import Vision
import UIKit

/// Receipt Scanner with OCR
class ReceiptScanner {
    static let shared = ReceiptScanner()
    
    struct ScannedReceipt {
        let merchantName: String?
        let totalAmount: Double?
        let date: Date?
        let items: [ReceiptItem]
        let rawText: String
    }
    
    struct ReceiptItem {
        let name: String
        let quantity: Int
        let price: Double
    }
    
    func scanReceipt(image: UIImage, completion: @escaping (Result<ScannedReceipt, Error>) -> Void) {
        guard let cgImage = image.cgImage else {
            completion(.failure(NSError(domain: "Invalid image", code: -1)))
            return
        }
        
        let request = VNRecognizeTextRequest { request, error in
            guard error == nil else {
                completion(.failure(error!))
                return
            }
            
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                completion(.failure(NSError(domain: "No text found", code: -2)))
                return
            }
            
            let recognizedText = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
            
            let receipt = self.parseReceipt(text: recognizedText)
            completion(.success(receipt))
        }
        
        request.recognitionLevel = .accurate
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            try? handler.perform([request])
        }
    }
    
    private func parseReceipt(text: String) -> ScannedReceipt {
        var merchantName: String?
        var totalAmount: Double?
        var items: [ReceiptItem] = []
        
        let lines = text.components(separatedBy: "\n")
        
        // Extract merchant (usually first line)
        if let first = lines.first {
            merchantName = first
        }
        
        // Extract total amount
        for line in lines {
            if line.lowercased().contains("total") {
                let numbers = line.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()
                if let amount = Double(numbers) {
                    totalAmount = amount / 100 // Convert cents to dollars
                }
            }
        }
        
        return ScannedReceipt(
            merchantName: merchantName,
            totalAmount: totalAmount,
            date: Date(),
            items: items,
            rawText: text
        )
    }
}
