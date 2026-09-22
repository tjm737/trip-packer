import Foundation
import Capacitor
import FoundationModels

/*
 * FoundationModelsPlugin -- exposes Apple's on-device model to the web layer.
 *
 * Why a plugin rather than a native screen: the packing and activity surfaces
 * are already built and tested in React. Porting them to SwiftUI to reach
 * Apple Intelligence would mean rewriting working code for no user-visible
 * gain. This bridge lets the existing web UI call the on-device model, so the
 * only thing that changes is where the answer comes from.
 *
 * Availability is the whole story here, and it is why every method answers
 * with a structured availability report rather than throwing. The model needs
 * iOS 26 AND a device that supports Apple Intelligence AND the feature to be
 * enabled AND the model downloaded. On a simulator, on an older device, or
 * with Apple Intelligence switched off, there is no model -- and that is a
 * normal state, not an error. The web layer decides what to show; this plugin
 * only reports the truth.
 *
 * Deliberately NOT done here: any judgement about WHAT to suggest. The plugin
 * passes a prompt and returns text. Keeping the prompt on the web side means
 * prompt changes do not require a native rebuild and an App Store review.
 */

@objc(FoundationModelsPlugin)
public class FoundationModelsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoundationModelsPlugin"
    public let jsName = "FoundationModels"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateStructured", returnType: CAPPluginReturnPromise),
    ]

    /// Build the report the web layer gates its UI on.
    ///
    /// `reason` is a stable machine-readable token, not prose, so the web
    /// layer can branch on it without string-matching human text. `message`
    /// is the human-readable part, and is safe to show directly.
    private func availabilityReport() -> [String: Any] {
        if #available(iOS 26.0, *) {
            let model = SystemLanguageModel.default
            switch model.availability {
            case .available:
                return [
                    "available": true,
                    "reason": "available",
                    "message": "On-device model is ready.",
                ]
            case .unavailable(let reason):
                switch reason {
                case .deviceNotEligible:
                    return [
                        "available": false,
                        "reason": "device_not_eligible",
                        "message": "This device does not support Apple Intelligence.",
                    ]
                case .appleIntelligenceNotEnabled:
                    return [
                        "available": false,
                        "reason": "not_enabled",
                        "message": "Turn on Apple Intelligence in Settings to get suggestions.",
                    ]
                case .modelNotReady:
                    return [
                        "available": false,
                        "reason": "model_not_ready",
                        "message": "The on-device model is still downloading.",
                    ]
                @unknown default:
                    return [
                        "available": false,
                        "reason": "unknown",
                        "message": "On-device model is unavailable.",
                    ]
                }
            }
        }

        return [
            "available": false,
            "reason": "os_too_old",
            "message": "Suggestions need iOS 26 or later.",
        ]
    }

    /// Report whether the on-device model can be used right now.
    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(availabilityReport())
    }

    /// Plain text generation: one prompt in, one string out.
    @objc func generate(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("A non-empty 'prompt' is required.")
            return
        }

        guard #available(iOS 26.0, *) else {
            call.reject("On-device model requires iOS 26 or later.", "os_too_old")
            return
        }

        Task {
            do {
                let session = LanguageModelSession()
                let response = try await session.respond(to: prompt)
                call.resolve(["text": response.content])
            } catch {
                call.reject(
                    "On-device generation failed: \(error.localizedDescription)",
                    "generation_failed"
                )
            }
        }
    }

    /// Structured generation: the model fills a caller-supplied JSON shape.
    ///
    /// The web layer sends the field names it wants, so the schema lives with
    /// the UI that renders it. Values are read back as strings because this is
    /// used for short labelled items (a packing suggestion, an activity name),
    /// not for numbers the plugin should be interpreting.
    @objc func generateStructured(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("A non-empty 'prompt' is required.")
            return
        }

        guard
            let fields = call.getArray("fields", String.self),
            !fields.isEmpty
        else {
            call.reject("A non-empty 'fields' array of strings is required.")
            return
        }

        guard #available(iOS 26.0, *) else {
            call.reject("On-device model requires iOS 26 or later.", "os_too_old")
            return
        }

        Task {
            do {
                let session = LanguageModelSession()
                let schema = String(
                    format: #"{"type":"object","properties":{%@},"required":[%@]}"#,
                    fields.map { #""\#($0)":{"type":"string"}"# }.joined(separator: ","),
                    fields.map { #""\#($0)""# }.joined(separator: ",")
                )

                // `DynamicGenerationSchema` is not used here on purpose: the
                // shape arrives at runtime, so it cannot be expressed as a
                // compile-time `@Generable` type. Generation therefore returns
                // free text that is asked to be JSON, and the web layer parses
                // it. The schema string above is a prompt contract, not a
                // compiler-enforced one.
                let response = try await session.respond(
                    to: """
                    \(prompt)

                    Reply with only a JSON object with exactly these keys: \
                    \(fields.joined(separator: ", ")). \
                    Every value must be a short string. No markdown, no prose, \
                    no code fences.
                    """
                )
                call.resolve([
                    "text": response.content,
                    "schema": schema,
                    "fields": fields,
                ])
            } catch {
                call.reject(
                    "On-device generation failed: \(error.localizedDescription)",
                    "generation_failed"
                )
            }
        }
    }
}
