import XCTest

/*
 * Verifies the map actually renders inside the Capacitor WebView.
 *
 * Why a UI test: the map is Leaflet in a WKWebView. A screenshot cannot
 * distinguish "Leaflet drew tiles" from "Leaflet failed and left a grey
 * rectangle", and the vision model has repeatedly misjudged exactly this case.
 *
 * Two constraints shape this file:
 *
 *   1. Taps must come from the accessibility layer, so they reach the page the
 *      way a finger does. Synthetic JS pointer events are ignored by Base UI.
 *
 *   2. XCUITest CANNOT evaluate JavaScript in a WKWebView. So the page publishes
 *      its own state through a hidden, accessibility-visible probe element
 *      (see MapProbe.tsx) and this test reads that text back. That keeps the
 *      evidence coming from the live DOM -- real tile counts and real decoded
 *      tiles -- without needing a JS bridge that does not exist.
 */
final class MapRenderTests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testMapTabRendersLeafletTiles() throws {
        let app = XCUIApplication()
        app.launch()

        // 1. The shell must reach the server. If the WebView failed to load,
        //    everything below is meaningless, so fail here rather than blaming
        //    the map for a connectivity problem.
        let webView = app.webViews.firstMatch
        XCTAssertTrue(
            webView.waitForExistence(timeout: 30),
            "no WKWebView appeared -- the shell did not load"
        )

        // 2. Open a trip.
        let trip = webView.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Iceland")
        ).firstMatch
        XCTAssertTrue(trip.waitForExistence(timeout: 30), "Iceland trip card not found")
        trip.tap()

        // 3. Tap the Map tab, so we do not silently pass on another tab.
        let mapTab = webView.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Map")
        ).firstMatch
        XCTAssertTrue(mapTab.waitForExistence(timeout: 20), "Map tab not found")
        mapTab.tap()

        // 4. Read the page's own report of what Leaflet rendered.
        let probe = webView.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "MAPPROBE")
        ).firstMatch

        XCTAssertTrue(
            probe.waitForExistence(timeout: 60),
            "the map probe never appeared -- the Map tab did not mount Leaflet"
        )

        let report = waitForProbeReport(probe: probe, timeout: 45)
        print("MAP_RESULT \(report)")

        let fields = parse(report)
        let tiles = fields["tiles"] ?? -1
        let loaded = fields["loaded"] ?? -1
        let errored = fields["errored"] ?? -1
        let pins = fields["pins"] ?? -1
        let pane = fields["pane"] ?? 0

        // 5. Leaflet created its pane. Proves the map component mounted at all.
        XCTAssertEqual(pane, 1, "no .leaflet-pane in the DOM -- Leaflet never initialised")

        // 6. Tiles exist, and at least one has DECODED. leaflet-tile-loaded is
        //    only applied after the image decodes, so this is real evidence
        //    rather than a count of <img> tags.
        XCTAssertGreaterThan(tiles, 0, "Leaflet rendered no tile <img> elements")
        XCTAssertGreaterThan(
            loaded, 0,
            "no tile reported leaflet-tile-loaded -- tiles exist but none decoded"
        )

        // 7. No broken tiles. A partially-failed map still looks plausible.
        XCTAssertEqual(errored, 0, "\(errored) tiles failed to load")

        // 8. The stops are on the map. This is what proves trip data reached
        //    Leaflet, not merely that some tiles downloaded.
        XCTAssertGreaterThan(pins, 0, "no stop markers on the map")
    }

    /* Polls until tiles have decoded, so we are not racing the async fetch. */
    private func waitForProbeReport(probe: XCUIElement, timeout: TimeInterval) -> String {
        let deadline = Date().addingTimeInterval(timeout)
        var report = probe.label
        while Date() < deadline {
            report = probe.label
            let f = parse(report)
            if let l = f["loaded"], let e = f["errored"], l > 0, e == 0 { return report }
            usleep(1_000_000)
        }
        return report
    }

    /* "MAPPROBE tiles=24 loaded=24 errored=0 pins=6 pane=1" -> dictionary */
    private func parse(_ s: String) -> [String: Int] {
        var out: [String: Int] = [:]
        for token in s.split(separator: " ") {
            let kv = token.split(separator: "=")
            if kv.count == 2, let v = Int(kv[1]) { out[String(kv[0])] = v }
        }
        return out
    }
}
