# Capacitor iOS shell — findings

## Status: native build succeeds, simulator launch pending runtime download

## What was built

    capacitor.config.ts          hosted-shell config, URL from TRIP_PACKER_URL
    ios/                         Xcode project (Swift Package Manager, not CocoaPods)
    ios/App/App/Info.plist       ATS exceptions for the dev host
    npm run ios:sync             cap sync ios
    npm run ios:build            xcodebuild against iphonesimulator SDK

`npx cap add ios` generated the project. It links plugins via **Swift Package
Manager**, so `brew install cocoapods` was not actually required — Capacitor 8
has moved off CocoaPods. Harmless, but do not assume pod is in the loop.

## Verified

- `xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator build`
  => **BUILD SUCCEEDED**
- All three plugins link and register: AppPlugin, PreferencesPlugin, StatusBarPlugin
- `cap sync ios` propagates `capacitor.config.ts` into
  `ios/App/App/capacitor.config.json` correctly
- `plutil -lint ios/App/App/Info.plist` => OK

## Not yet verified

The app has not been launched. `xcrun simctl list runtimes` is **empty** on this
machine — Xcode 27 is installed with the iOS 27 SDK, but no simulator runtime
image has ever been downloaded. Until that lands (~7GB, `xcodebuild
-downloadPlatform iOS`) there is no device to install onto. So "it builds" is
proven; "it runs and renders" is not.

## Why a hosted shell rather than a static export

The app cannot be statically exported as-is:
- `/trips/[id]` is a **dynamic route**; a static export has no server to resolve
  the id. It would have to become a query-param route.
- Every read and write goes through `/api/state` and `/api/mutate`, backed by
  `better-sqlite3` — a **Node-only** module that cannot run in a WebView.

Pointing the WebView at a live origin sidesteps both. It also means the app is
**not offline-capable** and is, in Apple's terms, a website wrapper — worth
knowing before submitting, since guideline 4.2 rejects wrappers with no native
functionality.

## Open decision: guideline 4.2 (Minimum Functionality)

**Unresolved.** The config work is done and the build is clean, but a green
build does not address 4.2: the app is still a hosted shell around a live site,
and Apple rejects wrappers that add no native capability. Deciding to submit
as-is means accepting a real chance of rejection.

Two paths, neither started:

1. **Add genuine native capability.** Something that uses the device rather than
   the browser — e.g. a local-first store, background refresh, or a native auth
   sheet.
2. **Submit and see.** Cheap to try, and a rejection is informative (Apple says
   which guideline), but it spends a review cycle and the submission has to be
   honest about being a wrapper.

### Sign in with Apple as a candidate for option 1

Researched while this decision was open; recorded because it is the strongest
candidate found so far, and because the constraints are easy to rediscover
costly.

- **"Sign in with Apple" is the only option.** There is no iCloud identity API
  for a third-party web app or site — no membership, no API. So the gate is the
  **$99/year Apple Developer Program**, not the code. That is the same cost
  already deferred once.
- **It must be Apple-only at first.** Guideline 4.8 requires that if an app
  offers any third-party sign-in, it must also offer Sign in with Apple. Adding
  Apple first is free; adding Google first would oblige us to add Apple too.
- **The obvious draw is that it may satisfy 4.2.** A native auth sheet is
  exactly the kind of device capability 4.2 looks for, so one piece of work
  could answer the guideline *and* add a convenience feature. This is the only
  framing found where the $99 buys something beyond convenience.

Fit with the current code is good:

- `session.ts` is provider-agnostic — it mints a session row keyed by a cookie
  pointing at `session.userId` and does not care how identity was proven. Apple
  sign-in would find-or-create a user row and then call the same session-minting
  path as `insertAccount`.
- The schema is ready: `email` and `passwordHash` are nullable `TEXT` added via
  `addColumnIfMissing`, and there is no existing oauth/provider column to
  conflict with. An `appleUserId TEXT` column follows the same pattern as
  `db.ts:247-249`.
- The password path stays untouched for existing accounts.

Where the cost actually is — **the shell, not the web flow:**

- The OAuth redirect has to land its callback correctly inside the Capacitor
  WebView. This is the uncertain part: it could be an afternoon, or a day of
  fighting session-cookie behaviour in the wrapped shell.
- Web-only is straightforward by comparison (redirect + callback route + verify
  the identity token against Apple's JWKS). So if this is ever built, build it
  **web-first and let the shell inherit it** — the reverse order attacks the
  hardest surface first.

Security note: this adds convenience, not safety. The existing email+password
path is PBKDF2-hashed, rate-limited, and its account-creation gate is tested
against privilege escalation, so nothing here is a fix for a weakness.

## The seam for going local-first later

All data access funnels through two functions in `src/lib/storage.ts`:

    fetchState()   line 176   reads; already falls back to a cached copy
    post()         line 87    every mutation, with one retry then queue

The UI never touches `fetch()` directly. So the local-first version is a
transport swap behind those two functions — IndexedDB as the source of truth,
with the VPS as a sync peer. There is already an offline queue
(`queueMutation` / `flushOfflineQueue`) with per-op retry and a rule that drops
deterministic failures rather than blocking the queue forever, which is most of
what a sync engine needs. What it lacks is reconciliation: it is fire-and-forget
and has no notion of two edits to the same trip.

## Environment notes

- Simulator reaches the dev server on **127.0.0.1:4000** — it shares the host's
  network stack. A physical device would need the Mac's LAN address instead,
  since loopback there means the phone itself.
- `curl http://192.168.0.234:4000/api/state` fails from this Mac while `nc -z`
  to the same host:port succeeds. That is the known system-resolver failure, not
  a server problem — the server is bound to `*:4000` and answers on loopback.
- Node v24.15.0, npm 11.13.0, Xcode 27.0 (27A266a), CocoaPods 1.17.0.

## Next steps

1. Finish the iOS runtime download, then:
   `xcrun simctl boot "iPhone 17 Pro"` and `npx cap run ios`
2. Confirm the app renders and the map loads inside the WebView.
3. Decide: stay hosted, or do the local-first transport swap.
4. **Decide guideline 4.2** — see the open decision above. Add native capability
   (Sign in with Apple is the leading candidate) or submit as a wrapper and
   accept the rejection risk. This blocks any public App Store submission.
