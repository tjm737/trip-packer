# Native screens — parked

The native SwiftUI screens (packing list, itinerary) are **off**. The app ships
the web wrapper only: the JS/Next.js UI you see in a browser is what runs on
device.

## Why

They behaved worse than the JS equivalents they replaced:

- **Teardown on tab exit was unreliable.** Leaving the Itinerary tab did not
  detach the native screen, so the previous tab's content stayed on screen over
  the tab the user switched to. This was never verified on device — the UI test
  covering it (`ios/App/AppUITests/NativeTabTeardownTests.swift`) was written
  but never passed, because each run failed on a bug in the test itself.
- **The embedded interaction was not intuitive.** The screen was drawn into the
  page region rather than presented modally, and the exit was the web tab bar
  rather than a Done button, which read as an uncaptured tap.

## How it is turned off

One constant, in `src/lib/nativeScreens.ts`:

```ts
const NATIVE_SCREENS_ENABLED = false;
```

Everything routes through `nativeScreensAvailable()`, so this covers every path.
The components (`NativePackingAutoOpen`, `NativeItineraryAutoOpen`) gate on that
function rather than on `Capacitor.getPlatform()`, so on iOS they resolve to "not
native" and render the web UI as they would in a browser.

Nothing was deleted. The Swift plugin, the components, the pure decision
functions and their tests all remain.

## Turning it back on

Flip the constant to `true`. That is necessary but **not sufficient** — fix
these first or the same problems come back:

1. **Verify teardown on a device.** Run
   `NativeTabTeardownTests` and get `NATIVE_RESULT afterLeavingTab ... closed=N`
   with `N != 0`. Get it passing before anything else; it has never passed.
2. **Fix the interaction.** Whatever made the embedded presentation feel
   unintuitive (see above) needs a decision, not just a re-enable.
3. **Decide whether it should be embedded at all.** The modal presentation was
   the earlier approach and was replaced by embedding; both have been tried.

## What is still wired up

- `src/lib/nativeScreens.ts` — the typed surface, plus the kill switch.
- `src/components/NativePackingAutoOpen.tsx`, `NativeItineraryAutoOpen.tsx` —
  self-gating mount points inside the trip page.
- `src/components/NativePresentationProbe.tsx` — publishes state to
  accessibility for the UI test. XCUITest cannot run JS in a WKWebView, so this
  hidden probe is the only way the test can observe the web layer.
- `src/lib/nativeTabPresentation.ts` — pure decision functions, still tested.
- `plugins/native-screens/ios/` — the Swift plugin (packing list, itinerary,
  theme, swipe rows, add-item sheet).
- `ios/App/AppUITests/` — `NativeTabTeardownTests.swift`, `MapRenderTests.swift`.

## Tests

`tests/native-screens-disabled.test.cjs` pins the disabled state. It is
mutation-tested: flipping `NATIVE_SCREENS_ENABLED` to `true` fails 3 of its 5
cases. If you change the kill switch, run it — a test that passes in both states
proves nothing.

The other native tests (`native-tab-presentation`, `native-presentation-geometry`,
`native-presentation-probe`, `itinerary-native-parity`) cover pure functions that
are independent of the switch and still pass.
