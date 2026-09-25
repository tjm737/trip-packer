# App Store review notes

Paste the relevant sections into App Store Connect → App Review Information →
Notes. The demo-account line goes in the credentials fields, not here.

---

## Review notes (paste this)

TripPlanner is a trip planning and packing app. Accounts are created by the
developer rather than through public sign-up, so please use the demo account
provided in the App Review Information section above. If anything about it does
not work, or you need a fresh one, contact tylerjamesmorgan@gmail.com and we
will respond promptly.

The app has no public sign-up by design. There is no "create account" screen,
and nothing is hidden behind the sign-in wall that you need in order to review
the app — the privacy policy and support page are both public.

### On-device packing suggestions

The app's central feature is a packing list that can suggest items for a trip.
These suggestions are generated **entirely on the device** using Apple
Intelligence through the Foundation Models framework. Nothing about what the
user is packing for is sent to our server or to any third party. This is a
deliberate design decision, not an implementation detail: it means the app
cannot function as a website would, because the generation only exists on
device.

To see it:

1. Sign in with the demo account.
2. Open any trip, then the **Packing** tab.
3. Tap **Suggest items**.

Suggestions appear as rows you tap to add. They never modify the list on their
own. If the device does not support Apple Intelligence, or the feature is
disabled in Settings, the button reports why instead of failing silently — and
the rest of the app works normally.

### Sign-in

The demo account has been supplied with trips already created, including
itinerary stops, reservations and packing items, so the app can be reviewed
without setting anything up first.

---

## Why this framing (for us, not for Apple)

**Guideline 4.2 — minimum functionality** is the main risk. The app is a native
shell over a web origin, which superficially resembles a repackaged website,
and that is a common rejection. Three things argue against it, and the notes
above lean on all three:

1. **A genuinely native capability.** On-device generation via Foundation
   Models has no web equivalent. This is the strongest point and it is why the
   feature has to work on a review device.
2. **No public sign-up, explained.** A reviewer who cannot get in rejects as
   "unreviewable". Being explicit about the invite model, and supplying working
   credentials, removes that.
3. **Public policy and support pages.** Shows the app is a real product with
   real operators, not a wrapper.

**The feature must work on the device Apple uses.** If it reports "needs iOS 26
or later" on their hardware, the 4.2 defence is gone. Verify on a device
running the current shipping iOS *before* submitting.

---

## Pre-submission checklist

App Store Connect metadata (not code — these are hard blocks in the web form):

- [ ] **Support URL** → `https://trips.planetracker.app/support`
- [ ] **Privacy Policy URL** → `https://trips.planetracker.app/privacy`
- [ ] Demo account credentials in App Review Information
- [ ] Review notes pasted above
- [ ] Screenshots (6.7" and 6.1" minimum)
- [ ] Age rating questionnaire
- [ ] Export compliance: the app uses HTTPS only, so it qualifies for the
      standard exemption

Verify in the binary:

- [x] `fcd7f98` and `48f4f36` are **deployed to production** — verified 23 Sep 2026:
      `/support` and `/privacy` both return 200, and chunk
      `421x_dnabo9kg.js` (containing the on-device prompt string "Planned
      activities") is served at 200 with 3.3 MB
- [ ] Packing suggestions work on a real device on shipping iOS
- [x] App icon present and correct (1024×1024, no alpha) — confirmed
- [x] `PrivacyInfo.xcprivacy` included in the target — confirmed
- [x] Account deletion reachable from Profile — present
- [ ] Version string bumped for the submission build

### Signing gotcha — the paid account does NOT upgrade the personal team

Confirmed 23 Sep 2026, after the membership was purchased:

- Xcode still reports `XQBRZ94BTS` as `"Brenda Morgan (Personal Team)"`,
  `isFreeProvisioningTeam = 1`, `teamType = "Personal Team"`
- The only provisioning profile on disk is a **personal-team development**
  profile for `com.tylermorgan.tripplanner`
- `ios/App/App.xcodeproj/project.pbxproj` hardcodes
  `DEVELOPMENT_TEAM = XQBRZ94BTS`

Apple keeps personal and paid teams as **separate entities**. Paying creates a
*new* team with a **different Team ID**; it does not convert the free one.
Before archiving for submission, `DEVELOPMENT_TEAM` must be changed to the new
paid Team ID, and the bundle ID must be registered under that team. Signing with
the personal team cannot produce an App Store distribution build.

Find the new Team ID at developer.apple.com → Membership, then confirm Xcode has
picked it up via Settings → Accounts. The cached record can lag behind the
purchase, sometimes by hours.


Not blockers, but worth knowing:

- Live Activities are parked pending the paid account; see
  `docs/live-activities-feasibility.md`. The paid account is required for
  submission anyway, so that decision is now made by submitting.
- The app reads no device location, so no location usage string is needed.
