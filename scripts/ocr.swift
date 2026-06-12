import Vision
import Foundation

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: swift ocr.swift <image_path>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let fileURL = URL(fileURLWithPath: imagePath)

// Check file exists
if !FileManager.default.fileExists(atPath: imagePath) {
    fputs("Error: File not found: \(imagePath)\n", stderr)
    exit(1)
}

let semaphore = DispatchSemaphore(value: 0)

let request = VNRecognizeTextRequest { request, error in
    defer { semaphore.signal() }
    
    if let error = error {
        fputs("OCR Error: \(error.localizedDescription)\n", stderr)
        return
    }
    
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    let text = observations.compactMap { obs -> String? in
        guard let candidate = obs.topCandidates(1).first else { return nil }
        return candidate.string
    }.joined(separator: "\n")
    
    if text.isEmpty {
        // No text found - might be a non-text image
        print("__NO_TEXT__")
    } else {
        print(text)
    }
}

request.recognitionLevel = VNRequestTextRecognitionLevel.accurate
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
request.usesLanguageCorrection = true

guard let cgImage = CGImageSourceCreateWithURL(fileURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(cgImage, 0, nil) else {
    // Try alternative loading
    guard let data = try? Data(contentsOf: fileURL),
          let dataProvider = CGDataProvider(data: data as CFData),
          let image = CGImage(pngDataProviderSource: dataProvider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) ?? CGImage(jpegDataProviderSource: dataProvider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else {
        fputs("Error: Cannot load image: \(imagePath)\n", stderr)
        exit(1)
    }
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try? handler.perform([request])
    semaphore.wait()
    exit(0)
}

let handler = VNImageRequestHandler(cgImage: image, options: [:])
try? handler.perform([request])
semaphore.wait()
