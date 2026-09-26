# App Store submission — identifiers and state

Reference sheet for the TripPlanner 1.0 submission. Keep this current; several
of these are needed at upload time and are annoying to re-derive.

## Identifiers

| Thing | Value |
|---|---|
| SKU | `dexterstrips` |
| Apple ID (ASC app id) | `6816529260` |
| Bundle identifier | `com.tylermorgan.tripplanner` |
| Team ID | `XQBRZ94BTS` |
| Apple ID (account) | `tytanic11@gmail.com` |
| Seller / entity name | Tyler James Morgan |
| Production origin | `https://trips.planetracker.app` |

The SKU is internal and never shown publicly. The Apple ID (a numeric app id,
not the Apple ID account) is what `xcrun altool` / `notarytool` style tooling and
ASC API calls reference.

## Signing state (verified 2026-09-26)

```
Distribution cert   Apple Distribution: TYLER JAMES MORGAN (XQBRZ94BTS)
Development cert    Apple Development: TYLER JAMES MORGAN
Provisioning        iOS Team Provisioning Profile: com.tylermorgan.tripplanner
                    expires 2027-09-26, bound to valid certs
Org / seller name   Tyler James Morgan    (confirmed in ASC, no D-U-N-S needed)
```

One `Apple Development` cert is revoked (`023D9B3C…`, the old
`tytanic11@gmail.com` one). Expected — Apple revokes superseded certs. It is no
longer referenced by the provisioning profile, so it is harmless. Leave it; do
not "clean it up".

Note: the Xcode project still carries `CODE_SIGN_IDENTITY = "iPhone Developer"`
(a name Apple retired years ago). With `CODE_SIGN_STYLE = Automatic` it is
overridden at archive time and works. If an archive fails with "no identity
found", clearing that stale string is the fix.

## Versioning

Two tracks, deliberately:

| Track | Version | Source |
|---|---|---|
| Web | `0.7.2` | `package.json`, `src/lib/changelog.ts` |
| iOS (App Store) | `1.0` | `MARKETING_VERSION` in the Xcode project |

They do not have to match, but the changelog only tracks the web track. Do not
assume `RELEASES[0]` describes the App Store build.

`tests/release-notes.test.cjs` enforces that `package.json` and
`RELEASES[0].version` agree. It does **not** know about `MARKETING_VERSION`.

**Build number** (`CURRENT_PROJECT_VERSION`) is manual and starts at `1`. App
Store Connect rejects any upload reusing a build number, so it must strictly
increase on every upload. Bump it by hand before each one. This is the most
likely cause of a rejected upload during TestFlight iteration.

## Export compliance

`ITSAppUsesNonExemptEncryption = false` is set in `ios/App/App/Info.plist`.
Without it a build sits in "Missing Compliance" and cannot be tested in
TestFlight.

The answer is false because the only crypto in the codebase
(`src/lib/auth.ts` — `pbkdf2Sync`, `createHash`, `randomBytes`) runs server-side
on Node and is never in the app bundle. On-device use is `crypto.randomUUID()`,
which is not encryption; transport is standard TLS.

**This answer changes if** the app gains encrypted local storage — offline
credential caching, or a travel-documents vault. At that point the answer
becomes true and the annual self-classification report applies.

## Submission checklist

- [x] Signing: distribution cert + profile valid
- [x] Export compliance declared
- [x] `/privacy` and `/support` live and public
- [x] Review notes written (`docs/app-store-review-notes.md`)
- [x] Seller name confirmed
- [ ] ASC record created → **done**: SKU `dexterstrips`, id `6816529260`
- [ ] Demo account created, with trips/stops/reservations/packing/bags
- [ ] Production deploy current (the shell loads the live origin)
- [ ] Archive uploaded, processed, TestFlight-tested
- [ ] Screenshots in required sizes
- [ ] App Privacy answers filled in

## Known risks

**Guideline 4.2 (minimum functionality)** is the primary risk — the app is a
native shell over a web origin. The defence is the on-device Foundation Models
feature, which has no web equivalent. If it is broken on the review device, the
strongest argument is gone. See `docs/app-store-review-notes.md`.

**The demo account is a release blocker, not a nicety.** Invite-only sign-up
means a reviewer who cannot get in rejects as "unreviewable". It needs a
working password and enough pre-populated data to show the app off — including
at least one bag, since that is a visible 1.0 feature.
