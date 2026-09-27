import Foundation
import FoundationModels

/*
 * Native-side access to Apple's on-device model.
 *
 * Why this exists alongside FoundationModelsPlugin: the plugin in
 * plugins/foundation-models serves the WEB layer over the Capacitor bridge.
 * The native packing screen is Swift -- it has no JS bridge to call through,
 * so it talks to LanguageModelSession directly.
 *
 * The two paths are deliberately kept in step rather than merged. A plugin
 * method returns through Capacitor's promise machinery, which a SwiftUI view
 * cannot await without inventing a bridge back across the boundary; calling
 * the framework directly is both simpler and faster. The cost is that the
 * availability states below are a second copy of availabilityReport() in
 * FoundationModelsPlugin.swift, so those two must change together.
 *
 * Every entry point reports unavailability as data rather than throwing,
 * matching the plugin: no model is a normal state (simulator, Apple
 * Intelligence off, model still downloading), not an error.
 */

struct FMAvailability {
    let available: Bool
    /// Human-readable, safe to show directly.
    let message: String
    /// Stable machine-readable token, mirrored from the plugin's `reason` so
    /// the two surfaces classify unavailability identically.
    let reason: String
}

struct FMResult {
    let text: String
}

enum FoundationModelsBridge {
    /// Whether the on-device model can be used right now.
    static func availability() async -> FMAvailability {
        guard #available(iOS 26.0, *) else {
            return FMAvailability(
                available: false,
                message: "Suggestions need iOS 26 or later.",
                reason: "os_too_old"
            )
        }

        switch SystemLanguageModel.default.availability {
        case .available:
            return FMAvailability(
                available: true,
                message: "On-device model is ready.",
                reason: "available"
            )
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible:
                return FMAvailability(
                    available: false,
                    message: "This device does not support Apple Intelligence.",
                    reason: "device_not_eligible"
                )
            case .appleIntelligenceNotEnabled:
                return FMAvailability(
                    available: false,
                    message: "Turn on Apple Intelligence in Settings to get suggestions.",
                    reason: "not_enabled"
                )
            case .modelNotReady:
                return FMAvailability(
                    available: false,
                    message: "The on-device model is still downloading.",
                    reason: "model_not_ready"
                )
            @unknown default:
                return FMAvailability(
                    available: false,
                    message: "On-device model is unavailable.",
                    reason: "unknown"
                )
            }
        }
    }

    /// Structured generation, asked for as JSON.
    ///
    /// Returns nil on any failure rather than throwing, so a model problem
    /// degrades to "no suggestions" instead of an error path the caller has to
    /// duplicate. The prompt is expected to specify the JSON shape itself;
    /// this appends only the format reinforcement, same as the plugin.
    ///
    /// `DynamicGenerationSchema` is not used, for the same reason as the
    /// plugin: the shape is a runtime value here, not a compile-time
    /// `@Generable` type.
    static func generateStructured(prompt: String, fields: [String]) async -> FMResult? {
        guard #available(iOS 26.0, *) else { return nil }
        guard !prompt.isEmpty, !fields.isEmpty else { return nil }

        let session = LanguageModelSession()
        let instruction = """
        \(prompt)

        Reply with only a JSON object with exactly these keys: \
        \(fields.joined(separator: ", ")). \
        Every value must be a short string. No markdown, no prose, \
        no code fences.
        """

        do {
            let response = try await session.respond(to: instruction)
            return FMResult(text: response.content)
        } catch {
            return nil
        }
    }
}
