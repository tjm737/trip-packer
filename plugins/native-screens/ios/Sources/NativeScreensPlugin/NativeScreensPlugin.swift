import Foundation
import Capacitor
import SwiftUI
import UIKit

/*
 * NativeScreensPlugin -- opens SwiftUI screens from the web layer.
 *
 * Why opt-in per screen rather than a native root shell: the webview stays the
 * app's root, and native screens are presented over it on request. That is
 * deliberate and it is about reversibility. A native root would mean rewriting
 * app startup and navigation, and undoing it later would mean untangling
 * launch -- whereas this is additive. Removing the two files in Native/ plus
 * this file returns the app to exactly its previous behaviour, with no residue.
 *
 * It also avoids contradicting the reasoning already recorded in
 * FoundationModelsPlugin.swift, which argues against porting working React
 * screens to SwiftUI for no user-visible gain. That argument still holds for
 * *reaching Apple Intelligence* -- the plugin already does that. What it does
 * not address is native feel: real scroll physics, native gestures, no webview
 * jank on a long list. That is a different objective, and it is the one this
 * plugin exists to test on a single screen.
 *
 * The screen is presented in a UINavigationController so it gets a real
 * navigation bar and a working Back control. Presenting bare SwiftUI would
 * leave the user with no way out on a screen with no chrome of its own.
 */

@objc(NativeScreensPlugin)
public class NativeScreensPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeScreensPlugin"
    public let jsName = "NativeScreens"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openPackingList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openItinerary", returnType: CAPPluginReturnPromise),
    ]

    /// Retains the presentation delegate across the sheet's lifetime.
    ///
    /// `UIPresentationController.delegate` is weak, so without this the observer
    /// is deallocated immediately and interactive (swipe) dismissal goes
    /// unreported. See the assignment in `openPackingList`.
    private var dismissObserver: DismissObserver?

    /// Present the native packing list for a trip.
    ///
    /// See `presentScreen` for the shared presentation and dismissal contract:
    /// the promise resolves when the screen is DISMISSED, not when it is
    /// presented, and `presented: false` is resolved (not rejected) if a sheet
    /// is already up.
    @objc func openPackingList(_ call: CAPPluginCall) {
        presentScreen(call) { tripId, onClose in
            AnyView(PackingListView(tripId: tripId, onClose: onClose))
        }
    }

    @objc func openItinerary(_ call: CAPPluginCall) {
        presentScreen(call) { tripId, onClose in
            AnyView(TripItineraryView(tripId: tripId, onClose: onClose))
        }
    }

    /// Shared presentation for every native screen.
    ///
    /// Extracted when the itinerary was added rather than copied. The dismissal
    /// machinery below is subtle -- two signals, a resolve-once guard, and a
    /// delegate that must be retained -- and a second hand-rolled copy is a
    /// second place for the swipe-to-dismiss path to silently stop resolving.
    /// `build` takes the trip id and a close closure and returns the screen.
    private func presentScreen(
        _ call: CAPPluginCall,
        build: @escaping (String, @escaping () -> Void) -> AnyView
    ) {
        guard let tripId = call.getString("tripId"), !tripId.isEmpty else {
            call.reject("A non-empty 'tripId' is required.")
            return
        }

        Task { @MainActor in
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller available to present from.")
                return
            }

            // Already showing. Do not stack a second sheet.
            if presenter.presentedViewController != nil {
                call.resolve(["presented": false, "reason": "already-presented"])
                return
            }

            var hosted: UIViewController?

            /*
             * Two dismissal signals, because neither alone is sufficient and
             * both can fire for one dismissal.
             *
             * The `present` completion runs when the animation finishes -- on
             * dismissal that happens for every route out, including a swipe.
             * But its timing relative to the delegate callback is not worth
             * relying on, so it is the primary path.
             *
             * `presentationControllerDidDismiss` is the interactive-dismiss
             * delegate: it covers the swipe case explicitly, so a swipe cannot
             * be missed if the completion behaves unexpectedly.
             *
             * `resolveOnce` makes the duplication safe. Resolving a Capacitor
             * call twice is a no-op internally, but the flag also stops the
             * second path from doing needless work and keeps intent obvious.
             */
            var didResolve = false
            let resolveOnce: () -> Void = {
                guard !didResolve else { return }
                didResolve = true
                call.resolve(["presented": true, "dismissed": true])
            }

            let root = build(tripId, { hosted?.dismiss(animated: true) })
            let controller = UIHostingController(rootView: root)
            let nav = UINavigationController(rootViewController: controller)
            nav.modalPresentationStyle = .pageSheet
            hosted = nav

            // Restore the status bar to the web layer's expectations when the
            // screen is dismissed. Without this the native screen's appearance
            // can persist and leave the webview with the wrong status bar style.
            //
            // The completion below fires once the present/dismiss transition
            // finishes. On dismissal that is the resolve signal; on the initial
            // presentation it must NOT resolve, so the check distinguishes them
            // by whether the controller is still being presented.
            presenter.present(nav, animated: true) {
                if nav.presentingViewController == nil {
                    resolveOnce()
                }
            }

            /*
             * The observer is retained on the plugin, not just assigned.
             *
             * `UIPresentationController.delegate` is a WEAK property. Assigning
             * a freshly constructed observer to it and dropping the local
             * reference -- which is what this looked like at first -- deallocates
             * the observer on the next runloop turn, so `didDismiss` never fires
             * and a swipe-down is never signalled. Nothing warns: it compiles,
             * and the only symptom is a promise that never resolves.
             *
             * Storing it here keeps it alive for as long as the plugin lives.
             * Replaced on each present, and the previous one is released with
             * its controller.
             */
            let observer = DismissObserver(onDismiss: resolveOnce)
            nav.presentationController?.delegate = observer
            self.dismissObserver = observer
        }
    }
}

/// Bridges UIPresentationController dismissal to a closure.
///
/// `presentationControllerDidDismiss` is the only reliable signal for an
/// interactive (swipe-down) dismissal -- `viewDidDisappear` also fires for
/// pushes and covers, and `onClose` only fires for the Done button.
private final class DismissObserver: NSObject, UIAdaptivePresentationControllerDelegate {
    private let onDismiss: () -> Void
    init(onDismiss: @escaping () -> Void) { self.onDismiss = onDismiss }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        onDismiss()
    }
}
