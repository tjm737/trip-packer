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
    ]

    /// Present the native packing list for a trip.
    ///
    /// Rejects rather than presenting an empty screen when no trip id is given:
    /// a blank native screen with no explanation is worse than a clear error,
    /// because the user cannot tell whether it failed or is still loading.
    @objc func openPackingList(_ call: CAPPluginCall) {
        guard let tripId = call.getString("tripId"), !tripId.isEmpty else {
            call.reject("A non-empty 'tripId' is required.")
            return
        }

        // Restore the status bar to the web layer's expectations when the
        // screen is dismissed. Without this the native screen's appearance can
        // persist and leave the webview with the wrong status bar style.
        Task { @MainActor in
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller available to present from.")
                return
            }

            var hosted: UIViewController?
            let root = PackingListView(
                tripId: tripId,
                onClose: { hosted?.dismiss(animated: true) }
            )
            let controller = UIHostingController(rootView: root)
            let nav = UINavigationController(rootViewController: controller)
            nav.modalPresentationStyle = .pageSheet
            hosted = nav

            presenter.present(nav, animated: true)

            // Resolved once presented, so the web layer can await the call and
            // know the screen is actually on its way up.
            call.resolve(["presented": true])
        }
    }
}
