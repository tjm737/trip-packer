# Live Activities for trip-packer — feasibility findings

Status: **PARKED** (decided by Tyler, Sep 2026). Do not build until the paid
Apple Developer account decision is made.

## The blocker

Live Activities cannot be driven from the existing Capacitor/Next.js stack.

- The lock-screen / Dynamic Island banner is rendered by a **widget extension
  process**, not the app. That process has no JavaScript engine, so it cannot
  call our `foundation-models` Capacitor plugin or any web code.
- Updates arrive two ways only:
  1. **Push** — the server sends APNs with `apns-push-type: liveactivity`, using
     a push key issued to **a paid account**. This is the only path that works
     while the app is backgrounded, which is when a departure countdown is
     actually useful.
  2. **`Activity.update()`** — foreground only. A countdown that ticks only
     while the user stares at the app is pointless.

Therefore: paid Apple Developer account ($99/yr) is **required**, not optional.

## Evidence gathered

| Fact | Value |
| --- | --- |
| Signing identity | `Apple Development: tytanic11@gmail.com (J859AAN6Q2)` |
| Development team | `XQBRZ94BTS` — **personal** |
| Provisioning profiles on disk | none |
| App bundle id | `com.tylermorgan.tripplanner` |
| Xcode targets | `application`, `ui-testing` only — **no widget target** |
| `IPHONEOS_DEPLOYMENT_TARGET` | `15.0` — Live Activities need **16.1+** |
| Capacitor deps | app, core, ios, preferences, share, status-bar (no activity plugin) |

The deployment-target mismatch is a trap: a widget target needs its own
minimum of 16.1, and discovering that mid-build produces a confusing failure.

## What CAN be built without the account (if unparked)

Roughly 95% of the engineering is account-free:

1. **Countdown data layer** — `Reservation` already carries `type: "flight"`,
   `startDate`, `startTime`, `location`, `locationTo`. Enough for
   "Departs CPH in 2h 14m". Pure logic, testable.
2. **Attributes contract** — the shared shape describing what the widget
   displays, so the Swift side is mechanical later.
3. **ContentState + lifecycle** — when an activity starts (~T-3h), updates,
   ends; and which flight is "next" across a multi-leg itinerary.
4. **Server-side push scheduler** — watches for near-departure flights.

Left for after payment: add the widget extension target, drop in the Swift
view, wire the push key.

Apple caps a Live Activity at 8 hours (12 for the ending state), which suits a
departure countdown well.

## Related, still-open thread

`com.tylermorgan.tripplanner` is a native shell over the **production** web URL.
Installing a new native build does NOT deliver new web features — you must
deploy to the server. See deploy/update.sh notes.

## Alternative that needs no account

Push notifications (not Live Activities) already work via **ntfy** —
topic `dexters-plane-tracker`, stored in `user_settings` alongside
`takeoff_enabled`, `proximity_radius`, `state_alerts`. That covers plane-tracker
alerting today with no paid account and no native target. It will not render in
the Dynamic Island, but it does deliver the underlying information.
