# Bag photos: storage options

Status: **deferred.** Bags ship manifest-first (itemised contents + claim export),
no photos. This records the storage analysis so the decision does not have to be
re-derived, and so the iCloud question gets a real answer rather than a shrug.

Asked: "can we store the photos to the user's iCloud?"

## The decisive constraint

The app is a **web app (Next.js on a VPS) inside an iOS shell**, and it has a web
deployment that is the single source of truth. Any storage mechanism that only
exists on iOS splits the feature in two.

**A browser has no access to iCloud.** There is no web API for it, at any
priority level. So iCloud can never serve web users. If photos go to iCloud, the
feature is iOS-only and the web app must gracefully show "available on iOS".

## What the app has today (checked, not assumed)

- **No entitlements file exists** for the app target at all. No
  `com.apple.developer.ubiquity-*` keys, no iCloud container.
- **No camera / filesystem / iCloud Capacitor plugin** installed.
- Capacitor plugins present: app, core, ios, preferences, share, status-bar.
- Local SPM plugins: `foundation-models`, `native-screens`.
- **No upload endpoint and no blob storage** of any kind server-side. The only
  file handling in the API is `src/app/api/import/route.ts`.

## Options

### 1. VPS disk / object storage (server-side)

- Works on **both** web and native. Single code path.
- Survives a **lost or stolen phone** — which is precisely the situation in
  which someone files a baggage claim, so this matters more than it first
  appears.
- A claim export can embed the images directly.
- Costs: unbounded disk growth with no lifecycle policy; `data/*.db` is backed up
  but a photos directory would need its own backup story, or a restore produces
  rows pointing at missing files. Privacy weight: we become custodian of photos
  of users' packed belongings, behind the same authz boundary that — as of
  `2bf4088` — had a real bug in it.

### 2. On-device only (app container)

- No entitlement, no server cost, no portal work. Most private.
- **Destroyed with the app**, and does not survive a device swap or reinstall.
- Same fatal flaw as iCloud for the claim use case, without iCloud's sync.

### 3. iCloud Drive (native plugin)

- **Privacy wins decisively**: images never touch our servers.
- Native-only; web users get nothing.
- Requires, in order:
  1. An iCloud container registered in the Apple Developer portal.
  2. An `App.entitlements` with the ubiquity container key — **the app currently
     has no entitlements file at all**, so this is new surface.
  3. **A regenerated provisioning profile**, i.e. re-signing. Existing installs
     are affected. This is the expensive, disruptive step.
  4. A new SPM plugin under `plugins/`, registered as a local npm package via
     `file:` — NOT dropped into `ios/App/App/`, where it would compile and ship
     but never register. Remember `registerPlugin(name, { web: () => ... })`
     needs the second argument or every web call throws "not implemented".

- **Critical limitation for this feature**: iCloud documents are private to the
  Apple ID. The app cannot read another user's iCloud, so iCloud storage can
  only ever be *local* storage. The manifest still has to leave the device via
  PDF / share sheet for the airline to receive it.
- **Failure mode**: files sync only for that Apple ID. A traveller abroad on a
  replacement phone, which is the actual claim scenario, may not be able to
  reach them. iCloud is not a backup you can count on from a different device
  without the same Apple ID and a working sign-in.

### 4. Photos library

- Write-only in practice: you can add to the user's library, you cannot read
  back what another device stored. It is the user's library, not app data.
- Not viable as the app's own record.

## Recommendation

**Manifest-first.** For an airline claim, what matters is an itemised record —
description, quantity, brand, approximate value, timestamp. That is searchable,
tiny, needs no storage at all, and is arguably *stronger* evidence than a
photograph of a dark suitcase interior.

If photos are added later: **VPS storage** is the pragmatic choice because it
works everywhere and survives a lost phone; **iCloud** is the right choice if the
priority is not being the custodian of users' luggage photos, accepting that the
feature becomes iOS-only and depends on the user still controlling that Apple ID.

## Open question (unanswered)

Whether the motivation for iCloud is **privacy** (avoid storing users' luggage
photos on our servers) or **convenience/sync**. The answer changes which option
is correct, and it was not resolved. Privacy points at iCloud; the claim use case
points at server-side.
