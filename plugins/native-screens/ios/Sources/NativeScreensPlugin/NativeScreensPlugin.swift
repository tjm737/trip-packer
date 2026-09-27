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
        CAPPluginMethod(name: "closeNativeScreen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFrame", returnType: CAPPluginReturnPromise),
    ]

    /// Retains the presentation delegate across the sheet's lifetime.
    ///
    /// `UIPresentationController.delegate` is weak, so without this the observer
    /// is deallocated immediately and interactive (swipe) dismissal goes
    /// unreported. See the assignment in `openPackingList`.
    private var dismissObserver: DismissObserver?

    /// The embedded child controller, when a screen is presented inside the page
    /// rather than as a modal sheet.
    ///
    /// Retained for the same reason as `dismissObserver`: nothing else holds a
    /// reference once the presentation call returns. Without this the controller
    /// deallocates, the view vanishes, and the only symptom is a blank region --
    /// with the promise already resolved, so nothing reports an error.
    private var embeddedController: UIViewController?

    /// Reports that the embedded screen went away.
    ///
    /// Set on each embedded presentation and cleared on teardown. This is the
    /// missing half of the embedded contract: `call.resolve` fires at
    /// presentation time (there is no dismissal to await), so without a separate
    /// signal a caller that awaited `openItinerary` would never learn the screen
    /// had closed.
    ///
    /// A settled Capacitor call cannot be resolved a second time, so this does
    /// NOT resolve the original promise again -- it is invoked through
    /// `resolveOnce`, which guards against double-resolve, and the web layer
    /// relies on `closeNativeScreen`'s own resolve for the "I asked it to close"
    /// path.
    private var onEmbeddedTeardown: (() -> Void)?

    /// Present the native packing list for a trip.
    ///
    /// See `presentScreen` for the shared presentation and dismissal contract:
    /// the promise resolves when the screen is DISMISSED, not when it is
    /// presented, and `presented: false` is resolved (not rejected) if a sheet
    /// is already up.
    @objc func openPackingList(_ call: CAPPluginCall) {
        presentScreen(call, build: { tripId, onClose, embedded in
            AnyView(PackingListView(tripId: tripId, onClose: onClose, embedded: embedded))
        })
    }

    @objc func openItinerary(_ call: CAPPluginCall) {
        presentScreen(call, build: { tripId, onClose, embedded in
            AnyView(TripItineraryView(tripId: tripId, onClose: onClose, embedded: embedded))
        })
    }

    /// Remove the embedded screen, if one is up.
    ///
    /// WHY THIS IS A JS-CALLABLE METHOD
    ///
    /// Embedded screens deliberately have no Done button: the web tab bar is the
    /// way out, and a second exit would duplicate it. That decision only works if
    /// switching tabs can actually take the native view down -- and until this
    /// method existed, nothing could.
    ///
    /// The close closure passed into `build` is wired to the native screen's own
    /// affordance, which embedded mode never renders. So `tearDownEmbedded` was
    /// reachable only from a button that does not exist, and tapping another web
    /// tab left the native view on screen, covering the tab the user had just
    /// switched to. The feature's whole premise -- that the native content
    /// belongs to the tab rather than covering the app -- failed at the first tab
    /// switch.
    ///
    /// Resolves `{ closed: Bool }` rather than rejecting when nothing is up: "it
    /// was already gone" is the desired end state, not an error, and callers fire
    /// this on unmount where a rejection would surface as an unhandled promise.
    @objc func closeNativeScreen(_ call: CAPPluginCall) {
        let had = embeddedController != nil
        tearDownEmbedded()
        call.resolve(["closed": had])
    }

    /// Move the embedded screen to a new region.
    ///
    /// WHY THIS EXISTS
    ///
    /// The web layer re-measures the tab panel while the native screen is up --
    /// on scroll, rotation, keyboard, and viewport resize -- and sends the new
    /// rectangle. Without a way to apply it, the native view stayed wherever it
    /// was first placed while the terrain under it moved: scroll the page and the
    /// panel slides out from under the native content, leaving a gap above and
    /// native content overlapping the tab bar below.
    ///
    /// Resolves `{ applied: Bool }`. A frame arriving with no embedded screen up
    /// is normal (a measurement in flight when the tab was left) so it is not an
    /// error, but the caller is told it had no effect.
    @objc func setFrame(_ call: CAPPluginCall) {
        guard let frame = parseFrame(call) else {
            call.reject("setFrame requires a frame")
            return
        }
        guard let controller = embeddedController else {
            call.resolve(["applied": false])
            return
        }
        /*
         * Animated off on purpose. This fires on every scroll frame, and
         * animating each one would fight the user's finger -- the native view
         * would lag behind the web chrome by the animation duration and visibly
         * swim. The web chrome moves instantly because it is the same scroll, so
         * the native frame must track it instantly too.
         */
        controller.view.frame = frame
        call.resolve(["applied": true])
    }

    /// Shared presentation for every native screen.
    ///
    /// Extracted when the itinerary was added rather than copied. The dismissal
    /// machinery below is subtle -- two signals, a resolve-once guard, and a
    /// delegate that must be retained -- and a second hand-rolled copy is a
    /// second place for the swipe-to-dismiss path to silently stop resolving.
    /// `build` takes the trip id and a close closure and returns the screen.
    ///
    /// Two presentation modes, chosen by whether the caller sent a frame:
    ///
    ///  - With a frame, the screen is embedded as a CHILD view controller inside
    ///    the page, in the region the web tab panel occupies. The web header and
    ///    tab bar stay visible and tappable, so switching tabs is instant and
    ///    nothing slides over the app. This is the normal path on the trip page.
    ///
    ///  - Without one, it falls back to a full-screen modal sheet. That keeps a
    ///    caller that could not measure working, and it is what a screen with no
    ///    page around it wants.
    private func presentScreen(
        _ call: CAPPluginCall,
        build: @escaping (String, @escaping () -> Void, Bool) -> AnyView
    ) {
        guard let tripId = call.getString("tripId"), !tripId.isEmpty else {
            call.reject("A non-empty 'tripId' is required.")
            return
        }

        let frame = parseFrame(call)

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

            if let frame {
                self.presentEmbedded(call, in: presenter, frame: frame, tripId: tripId, build: build)
            } else {
                self.presentModal(call, in: presenter, tripId: tripId, build: build)
            }
        }
    }

    /// Read the optional presentation frame off the call.
    ///
    /// Returns nil when absent or malformed, which selects the modal fallback.
    /// A malformed frame is treated as "no frame" rather than as an error: the
    /// screen is still worth showing, just less prettily, and refusing to show
    /// it because a measurement was odd would turn a cosmetic problem into a
    /// missing feature.
    private func parseFrame(_ call: CAPPluginCall) -> CGRect? {
        guard let dict = call.getObject("frame") else { return nil }
        guard
            let top = doubleValue(dict["top"]),
            let left = doubleValue(dict["left"]),
            let width = doubleValue(dict["width"]),
            let height = doubleValue(dict["height"])
        else { return nil }

        /*
         * Reject non-finite values explicitly. NaN arrives readily from a JS
         * measurement taken before layout, and a NaN frame is not "invalid but
         * close enough" -- UIKit renders it as an undefined result rather than
         * falling back, so it must not reach the layout call.
         */
        guard top.isFinite, left.isFinite, width.isFinite, height.isFinite else { return nil }
        guard width > 0, height > 0 else { return nil }

        return CGRect(x: left, y: top, width: width, height: height)
    }

    /// Capacitor may hand numbers back as Int or Double depending on how JS
    /// serialized them, so both are accepted rather than assuming one.
    private func doubleValue(_ any: Any?) -> Double? {
        if let d = any as? Double { return d }
        if let i = any as? Int { return Double(i) }
        if let n = any as? NSNumber { return n.doubleValue }
        return nil
    }

    /// Embed the screen inside the page, below the web chrome.
    ///
    /// The child controller is added to the bridged view controller and sized to
    /// the measured region, with a clear background so the web page's own
    /// background shows through anywhere the native content does not cover.
    ///
    /// There is no dismissal gesture: the web tab bar is the way out, and the
    /// page unmounts this component when the user leaves the tab, which closes
    /// it. That is the point of the whole change -- the user navigates with the
    /// app's own chrome instead of dismissing a window.
    private func presentEmbedded(
        _ call: CAPPluginCall,
        in presenter: UIViewController,
        frame: CGRect,
        tripId: String,
        build: @escaping (String, @escaping () -> Void, Bool) -> AnyView
    ) {
        var hosted: UIViewController?

        var didResolve = false
        let resolveOnce: () -> Void = {
            guard !didResolve else { return }
            didResolve = true
            call.resolve(["presented": true, "dismissed": true])
        }

        let root = build(tripId, {
            // Closing is a request from the native screen itself (its own close
            // affordance). Tear the child out and tell the web layer.
            self.tearDownEmbedded()
            resolveOnce()
        }, true)

        let controller = UIHostingController(rootView: root)
        controller.view.backgroundColor = .clear
        controller.view.frame = frame

        /*
         * Track the presenter's bounds.
         *
         * An explicit frame alone does not survive a bounds change: rotate the
         * device and the child view keeps its old geometry while the page under it
         * reflows, so the native content ends up the wrong size and off-centre.
         * The plugin re-sends a frame on rotation too (the web layer observes
         * resize), but that arrives a frame later than UIKit's own relayout, and
         * the mask avoids the visible snap between the two.
         */
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        /*
         * The native screens were written for a full-screen sheet with their own
         * navigation bar and title. Inside the page that bar would be a second
         * header stacked under the web one, duplicating the trip name. The web
         * header is the real one -- it carries the name, destination, dates and
         * the back control -- so the native bar is hidden and the native content
         * becomes purely the panel.
         *
         * Done here rather than by editing each screen, so both tabs behave
         * identically and a future third screen cannot forget.
         */
        controller.navigationItem.title = nil

        // The status bar is the web layer's to own in this mode; the native
        // screen is no longer full-screen so it must not claim it.
        controller.view.insetsLayoutMarginsFromSafeArea = false

        presenter.addChild(controller)
        presenter.view.addSubview(controller.view)
        controller.didMove(toParent: presenter)

        // Held so it can be removed on close or on a re-present.
        self.embeddedController = controller
        hosted = controller

        /*
         * Resolve on PRESENTATION, with `dismissed: false` making that explicit.
         *
         * A child controller has no completion signal, and in this mode there is
         * no dismissal to wait for -- the web tab bar is the way out and the web
         * layer drives teardown itself via `closeNativeScreen`. So resolving here
         * is honest rather than premature.
         *
         * The previous code also stored `resolveOnce` and did nothing with it
         * (`_ = resolveOnce`), which made the type look used while leaving no path
         * that could ever report a close. Teardown is now reported through
         * `onTeardown`, called from `tearDownEmbedded` -- the single place the
         * child is removed, whichever path asked for it.
         */
        self.onEmbeddedTeardown = { resolveOnce() }
        call.resolve(["presented": true, "dismissed": false])
        _ = hosted
    }

    /// Remove the embedded child controller, if any.
    private func tearDownEmbedded() {
        guard let controller = embeddedController else { return }
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
        embeddedController = nil

        /*
         * Clear before invoking, and invoke through a local copy.
         *
         * The callback could re-enter teardown (a caller that closes in response
         * to a close), and reading a property that is about to be nil'd is how
         * that becomes a crash or an infinite loop. Taking a local copy and
         * clearing the stored one first makes re-entrancy a no-op.
         */
        let notify = onEmbeddedTeardown
        onEmbeddedTeardown = nil
        notify?()
    }

    /// Present as a full-screen modal sheet.
    ///
    /// The original path, and the fallback when no frame was supplied. Kept
    /// intact rather than replaced: its dismissal handling is the referent for
    /// the swipe-signal behaviour described in the comments below.
    private func presentModal(
        _ call: CAPPluginCall,
        in presenter: UIViewController,
        tripId: String,
        build: @escaping (String, @escaping () -> Void, Bool) -> AnyView
    ) {
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

            let root = build(tripId, { hosted?.dismiss(animated: true) }, false)
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
