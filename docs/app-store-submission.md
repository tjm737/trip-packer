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

## Archive and export (verified 2026-09-27)

```
# archive
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination "generic/platform=iOS" -archivePath /tmp/tparchive.xcarchive archive

# export for App Store Connect
xcodebuild -exportArchive -archivePath /tmp/tparchive.xcarchive \
  -exportOptionsPlist /tmp/ExportOptions.plist -exportPath /tmp/tpexport \
  -allowProvisioningUpdates
```

`ExportOptions.plist` needs `method = app-store-connect` and `teamID =
XQBRZ94BTS`. **The export fails without `-allowProvisioningUpdates`** ("No
profiles for com.tylermorgan.tripplanner were found") — the archive itself
succeeds, so this looks like a signing failure but is only a missing profile
fetch.

Verified from the exported `.ipa`: signed `Apple Distribution: TYLER JAMES
MORGAN (XQBRZ94BTS)`, profile `iOS Team Store Provisioning Profile`, expires
2027-09-26, `get-task-allow = false` (so it is genuinely a distribution build),
bundle `com.tylermorgan.tripplanner` 1.0 (1).

**Pitfall — do not use `nm` to check a Release binary.** Release strips the
symbol table, so `nm | grep PackingListView` returns 0 hits and looks like the
native screens are missing from the shipping app. They are there; use
`strings` instead. This cost real time during the first Release pass.

## Testing a Release build on a device

The App Store `.ipa` cannot be installed on a device — it is distribution
signed. To exercise Release behaviour against production, build for the device
instead (same optimization, same production URL, development-signed):

```
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination "id=<UDID>" -derivedDataPath /tmp/tprelease build
xcrun devicectl device install app --device <UDID> \
  /tmp/tprelease/Build/Products/Release-iphoneos/App.app
```

`devicectl` **cannot launch while the device is locked** — it fails with
`BSErrorCodeDescription = Locked` and `RequestDenied`, which reads like a
signing or provisioning problem but is not. Unlock the phone and retry.

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
- [x] `/privacy` and `/support` live and public (both 200)
- [x] Review notes written (`docs/app-store-review-notes.md`)
- [x] Seller name confirmed
- [x] ASC record created → SKU `dexterstrips`, id `6816529260`
- [x] Demo account created, with trips/stops/reservations/packing/bags
- [x] iOS deployment target raised to 17 (was 15; see `140791c`)
- [ ] Production deploy current — `50f7d6e` was deployed and verified, but
      `e41166c` (demo bags) still needs a deploy for the reviewer to see bags
- [ ] Archive uploaded, processed, TestFlight-tested
- [ ] Screenshots in required sizes — **nothing exists yet; see below**
- [ ] App Privacy answers filled in (ASC questionnaire, separate from the manifest)

## Screenshots

None exist in the repo, and ASC will reject the submission without them. At
minimum 6.9" (iPhone 17 Pro Max class); 6.5" is worth adding too.

They must be shot from a **Release** build pointed at production. Debug builds
load the dev server over the LAN, so the screenshots would not match what a
reviewer sees — and the trip page is auth-gated, so it needs a signed-in session
against the live origin.

Suggested set, in order: trip list with a countdown, packing list with bags,
trip timeline, map, live flight status. The first two do most of the selling.

## Known risks

**Guideline 4.2 (minimum functionality)** is the primary risk — the app is a
native shell over a web origin. The defence is the on-device Foundation Models
feature, which has no web equivalent. If it is broken on the review device, the
strongest argument is gone. See `docs/app-store-review-notes.md`.

**The demo account is a release blocker, not a nicety.** Invite-only sign-up
means a reviewer who cannot get in rejects as "unreviewable". It needs a
working password and enough pre-populated data to show the app off — including
at least one bag, since that is a visible 1.0 feature.
