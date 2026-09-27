import XCTest

/*
 * Verifies that a native screen embedded in a tab is TORN DOWN when the user
 * leaves that tab.
 *
 * WHY THIS TEST EXISTS
 *
 * The embedded screens have no Done button by design -- the web tab bar is meant
 * to be the exit, because a native screen that owns its own dismissal reads as a
 * window over the app rather than a tab belonging to it. That works only if
 * leaving the tab actually removes the native view. When it does not, the child
 * view controller stays up covering the tab the user switched TO, and the user
 * sees the wrong content with no way back. That is the regression this pins.
 *
 * WHY IT IS A UI TEST
 *
 * Nothing cheaper can see it:
 *
 *   - The regression suite is pure functions. It can prove `closeNativeScreen`
 *     was called in the tab-exit cleanup; it cannot prove the native view went
 *     away, because the view is UIKit's, not the page's.
 *   - A screenshot is USELESS here, and that is the trap. The native content is
 *     an opaque SwiftUI child drawn over the WebView, so a screenshot looks
 *     identical whether the child was removed or is sitting on top of the new
 *     tab. Vision would confidently report "the itinerary is showing" for both.
 *   - XCUITest cannot evaluate JavaScript in a WKWebView, so it cannot inspect
 *     the DOM or call the plugin.
 *
 * So the page reports on itself through `NativePresentationProbe`, exactly as
 * `MapProbe` does for Leaflet: a hidden, accessibility-visible line of text
 * carrying the values the presentation path actually decided on. See that file
 * for why the fields are what they are.
 *
 * The test reads the probe, not the screen -- which is the only evidence
 * available, and the reason this file is longer than a tap sequence.
 */
final class NativeTabTeardownTests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /*
     * Leaving the Itinerary tab must request teardown of the native screen.
     *
     * The assertion is deliberately on the CLOSE COUNT rather than on
     * `presenting` going back to 0. `presenting` is the web layer's belief about
     * its own state; the close count is the evidence that the call which takes
     * the native view down actually went out. A build that cleared `presenting`
     * without calling the plugin would look fine by `presenting` and leave the
     * user staring at an orphaned child controller -- which is the bug.
     */
    func testLeavingItineraryTabClosesNativeScreen() throws {
        /*
         * SKIPPED -- native screens are disabled, so this cannot pass.
         *
         * The test watches an accessibility probe that only mounts when a native
         * screen is presented, and it is behind NativeItineraryAutoOpen's
         * `if (!isNative) return null` gate. `nativeScreensAvailable()` is false
         * while NATIVE_SCREENS_ENABLED is false, so no probe ever appears and the
         * test fails on "the presentation probe never appeared" -- an assertion
         * that is now proving the feature is off rather than testing teardown.
         *
         * A `throw XCTSkip` rather than an XCTFail or a commented-out body: it
         * reports as a skip, so it is visibly intentional rather than a red test
         * that trains people to ignore failures. The body is left intact so that
         * re-enabling the feature is a one-line delete.
         *
         * The teardown path was NEVER verified -- no run of this test has passed
         * since it was written (each earlier attempt failed on a bug in the test
         * itself). Fix that before re-enabling, per docs/native-screens-parked.md.
         */
        throw XCTSkip(
            "Native screens are disabled (NATIVE_SCREENS_ENABLED = false), so the "
            + "presentation probe never mounts. See docs/native-screens-parked.md."
        )

        /*
         * No launch argument resets the close counter, and none is needed: each
         * launch is a fresh WebView with a fresh module instance, so the counter
         * starts at 0 by construction. Passing a flag the app does not read
         * would suggest a reset that does not happen.
         */
        let app = XCUIApplication()
        app.launch()

        let webView = app.webViews.firstMatch
        XCTAssertTrue(
            webView.waitForExistence(timeout: 30),
            "no WKWebView appeared -- the shell did not load"
        )

        /*
         * Open a trip WITHOUT assuming which account is signed in.
         *
         * The selector is "Open ..." because TripCard renders
         * title={`Open ${trip.name}`} (SidebarContent.tsx) -- a label every trip
         * card carries and no other control does. Earlier revisions matched on
         * card body text ("Packing"/"PACKED"/"ITEMS"), which also matches the
         * summary stat cards and the New Trip button; that loose predicate is
         * what let a blind tap navigate off the list and kill the app, leaving
         * a later assertion to fail with a misleading "probe never appeared".
         *
         * Deliberately not a named trip: this runs against the live deployment,
         * so the WebView holds whichever session is already signed in -- on a
         * dev machine, the developer's own account, not the App Review demo
         * account whose seeded trips ("Lisbon", "Chicago") do not exist there.
         * Teardown-on-tab-exit is identical for every trip, so any trip will do.
         */
        var trip = webView.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Open ")
        ).firstMatch
        if !trip.waitForExistence(timeout: 20) {
            // The sidebar may be collapsed to the icon rail at this width, with
            // trip cards not mounted. Open it, then retry once.
            let home = webView.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "TripPlanner home")
            ).firstMatch
            if home.exists { home.tap() }
            trip = webView.buttons.matching(
                NSPredicate(format: "label BEGINSWITH %@", "Open ")
            ).firstMatch
        }
        XCTAssertTrue(
            trip.waitForExistence(timeout: 30),
            """
            no trip card found (looked for a button labelled "Open ..."). This \
            test needs a signed-in session with at least one trip; it does NOT \
            need a specific trip, so this means the account has no trips or the \
            sidebar never rendered -- not that a fixture is missing.
            """
        )
        trip.tap()

        // Baseline. The probe must exist and the shell must be iOS, or every
        // assertion below is measuring nothing.
        let probe = webView.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "NATIVEPROBE")
        ).firstMatch

        XCTAssertTrue(
            probe.waitForExistence(timeout: 30),
            "the presentation probe never appeared -- is this build running in the iOS shell, and is the probe mounted outside the fallback branch?"
        )

        let baseline = parse(probe.label)
        XCTAssertEqual(
            baseline["native"], 1,
            "the shell was not detected as iOS, so no native screen would be presented at all (report: \(probe.label))"
        )

        // Go to the Itinerary tab, which is where native content presents.
        let itineraryTab = webView.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Itinerary")
        ).firstMatch
        XCTAssertTrue(itineraryTab.waitForExistence(timeout: 20), "Itinerary tab not found")
        itineraryTab.tap()

        /*
         * Wait for the present to land. A frame of "none" means the region was
         * not measured -- the page declined to present, so a later teardown
         * assertion would pass for the wrong reason and prove nothing.
         */
        let presented = waitFor(probe: probe, timeout: 45) { f in
            f["native"] == 1 && f["height"] != nil && (f["height"] ?? 0) > 0
        }
        XCTAssertTrue(
            presented,
            "the tab never produced a usable presentation region, so nothing was presented and the teardown below cannot be tested (report: \(probe.label))"
        )
        print("NATIVE_RESULT presented \(probe.label)")

        /*
         * Leave the tab. The cleanup that must run here is the ONLY thing that
         * takes the embedded native view down.
         */
        let mapTab = webView.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Map")
        ).firstMatch
        XCTAssertTrue(mapTab.waitForExistence(timeout: 20), "Map tab not found")
        mapTab.tap()

        /*
         * The close count is reported by the probe that is STILL MOUNTED -- after
         * the itinerary unmounted. That is why the counter is module-level: the
         * component that increments it is gone by now, and a per-mount value
         * would have died with it, making this assertion unable to distinguish
         * "no close" from "nothing left to report it".
         */
        let closed = waitFor(probe: probe, timeout: 20) { f in
            (f["closed"] ?? 0) > 0
        }

        print("NATIVE_RESULT afterLeavingTab \(probe.label)")

        XCTAssertTrue(
            closed,
            "leaving the Itinerary tab did not request teardown of the native screen. The child view controller will stay on screen covering the tab the user switched to. (report: \(probe.label))"
        )
    }

    /* Polls the probe until `predicate` holds, so we are not racing the UI. */
    private func waitFor(
        probe: XCUIElement,
        timeout: TimeInterval,
        _ predicate: ([String: Int]) -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if predicate(parse(probe.label)) { return true }
            usleep(500_000)
        }
        return predicate(parse(probe.label))
    }

    /*
     * "NATIVEPROBE native=1 top=312 height=418 presenting=1 closed=0 reason=none"
     * -> ["native": 1, "top": 312, ...]
     *
     * `top=none` / `height=none` / `reason=some-reason` are non-numeric and are
     * dropped, which is what the callers' absence checks rely on: a missing key
     * means "none", and there is no zero to be confused with a real measurement.
     */
    private func parse(_ s: String) -> [String: Int] {
        var out: [String: Int] = [:]
        for token in s.split(separator: " ") {
            let kv = token.split(separator: "=")
            if kv.count == 2, let v = Int(kv[1]) { out[String(kv[0])] = v }
        }
        return out
    }
}
