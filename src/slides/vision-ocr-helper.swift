import AppKit
import Foundation
import Vision

struct Configuration {
    let imagePath: String
    let preserveLineBreaks: Bool
    let recognitionLevel: RecognitionLevel
    let useLanguageCorrection: Bool
}

enum RecognitionLevel: String {
    case accurate
    case fast
}

struct TextFragment {
    let text: String
    let box: CGRect

    var centerY: CGFloat { box.midY }
    var leftX: CGFloat { box.minX }
    var height: CGFloat { box.height }
}

struct FragmentLine {
    var fragments: [TextFragment]
    var averageCenterY: CGFloat
    var averageHeight: CGFloat
}

enum HelperError: Error {
    case usage(String)
    case runtime(String)
}

let whitespaceExpression = try! NSRegularExpression(pattern: "\\s+", options: [])

do {
    let configuration = try parseConfiguration(arguments: Array(CommandLine.arguments.dropFirst()))
    let text = try recognizeText(using: configuration)
    FileHandle.standardOutput.write(Data(text.utf8))
} catch HelperError.usage(let message) {
    fputs("Usage error: \(message)\n", stderr)
    exit(2)
} catch HelperError.runtime(let message) {
    fputs("\(message)\n", stderr)
    exit(1)
} catch {
    fputs("Unexpected OCR failure: \(error.localizedDescription)\n", stderr)
    exit(1)
}

func parseConfiguration(arguments: [String]) throws -> Configuration {
    var imagePath: String?
    var preserveLineBreaks = true
    var recognitionLevel: RecognitionLevel = .accurate
    var useLanguageCorrection = true
    var index = 0

    while index < arguments.count {
        switch arguments[index] {
        case "--image-path":
            index += 1
            guard index < arguments.count else {
                throw HelperError.usage("Missing value for --image-path.")
            }
            imagePath = arguments[index]
        case "--collapse-line-breaks":
            preserveLineBreaks = false
        case "--recognition-level":
            index += 1
            guard index < arguments.count else {
                throw HelperError.usage("Missing value for --recognition-level.")
            }
            guard let parsedRecognitionLevel = RecognitionLevel(rawValue: arguments[index]) else {
                throw HelperError.usage("Invalid value for --recognition-level. Use `accurate` or `fast`.")
            }
            recognitionLevel = parsedRecognitionLevel
        case "--disable-language-correction":
            useLanguageCorrection = false
        default:
            throw HelperError.usage("Unknown argument: \(arguments[index])")
        }

        index += 1
    }

    guard let imagePath else {
        throw HelperError.usage("An --image-path value is required.")
    }

    return Configuration(
        imagePath: imagePath,
        preserveLineBreaks: preserveLineBreaks,
        recognitionLevel: recognitionLevel,
        useLanguageCorrection: useLanguageCorrection
    )
}

func recognizeText(using configuration: Configuration) throws -> String {
    guard FileManager.default.fileExists(atPath: configuration.imagePath) else {
        throw HelperError.runtime("Slide image does not exist.")
    }

    guard let image = NSImage(contentsOfFile: configuration.imagePath) else {
        throw HelperError.runtime("Unable to load the slide image.")
    }

    var proposedRect = CGRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
        throw HelperError.runtime("Unable to decode the slide image.")
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = configuration.recognitionLevel == .fast ? .fast : .accurate
    request.usesLanguageCorrection = configuration.useLanguageCorrection
    request.preferBackgroundProcessing = false

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

    do {
        try handler.perform([request])
    } catch {
        throw HelperError.runtime("Vision OCR failed: \(error.localizedDescription)")
    }

    let fragments = (request.results ?? []).compactMap { observation -> TextFragment? in
        guard let candidate = observation.topCandidates(1).first else {
            return nil
        }

        let text = collapseWhitespace(candidate.string)
        guard !text.isEmpty else {
            return nil
        }

        return TextFragment(text: text, box: observation.boundingBox)
    }

    let orderedLines = orderLines(from: fragments)

    if configuration.preserveLineBreaks {
        return orderedLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    return collapseWhitespace(orderedLines.joined(separator: " "))
}

func orderLines(from fragments: [TextFragment]) -> [String] {
    let sorted = fragments.sorted { left, right in
        let lineThreshold = max(max(left.height, right.height) * 0.6, 0.015)

        if abs(left.centerY - right.centerY) > lineThreshold {
            return left.centerY > right.centerY
        }

        return left.leftX < right.leftX
    }

    var lines: [FragmentLine] = []

    for fragment in sorted {
        if let lastIndex = lines.indices.last {
            let threshold = max(max(lines[lastIndex].averageHeight, fragment.height) * 0.6, 0.015)

            if abs(lines[lastIndex].averageCenterY - fragment.centerY) <= threshold {
                lines[lastIndex].fragments.append(fragment)
                let count = CGFloat(lines[lastIndex].fragments.count)
                lines[lastIndex].averageCenterY =
                    ((lines[lastIndex].averageCenterY * (count - 1)) + fragment.centerY) / count
                lines[lastIndex].averageHeight =
                    ((lines[lastIndex].averageHeight * (count - 1)) + fragment.height) / count
                continue
            }
        }

        lines.append(
            FragmentLine(
                fragments: [fragment],
                averageCenterY: fragment.centerY,
                averageHeight: fragment.height
            )
        )
    }

    return lines.compactMap { line in
        let text = line.fragments
            .sorted { $0.leftX < $1.leftX }
            .map(\.text)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return text.isEmpty ? nil : text
    }
}

func collapseWhitespace(_ text: String) -> String {
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    let collapsed = whitespaceExpression.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: " ")
    return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
}
