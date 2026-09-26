# TripPlanner — feature backlog

Ideas for after 1.0 ships, ordered by what they do for the App Store position
first and the product second. Nothing here is committed; this is a menu.

The bias throughout: **native capabilities that a website cannot have.** The
app's standing rejection risk is guideline 4.2 (minimum functionality), and the
only durable answer is a growing set of things the WebView cannot do. A feature
that merely looks nice in a screenshot buys nothing against that risk.

---

## Tier 1 — strengthens the App Store position

These exist to make 4.2 a non-issue, permanently rather than per-review.

### 1. Live Activities for departure day
**Parked by decision — revisit.** A Lock Screen / Dynamic Island card showing
"Next: UA 234, 3h 20m, Gate B12" that counts down without opening the app. This
is the single clearest native-only feature: there is no web equivalent on iOS,
reviewers understand it instantly, and it is visible on the Lock Screen while the
app is closed. The feasibility work is already done
(`docs/live-activities-feasibility.md`); the decision was cost, not doubt.

### 2. Widgets — trip countdown and next item
Small/medium Home Screen widgets: days until departure, next itinerary item,
packing progress as a ring. WidgetKit is another native-only surface, and a
widget on the reviewer's Home Screen is proof of a native app before they open
anything.

### 3. Apple Intelligence: document → itinerary
Extend the existing Foundation Models plugin beyond packing suggestions. Point
the camera at a booking confirmation, extract flight/hotel details on device via
OCR + Foundation Models, and create the reservation. Federated extraction is
harder than generation and would be a genuine flagship feature.

### 4. App Intents — "Hey Siri, add milk to my Tokyo trip"
Exposes trips to Shortcuts, Spotlight and Siri with no server round-trip. Also
makes the app's data usable inside the OS, which is exactly the "integrated
native app" impression reviewers are checking for.

### 5. Share sheet extension
Share a confirmation email or a flight page from Safari straight into a trip.
Already partly built (`src/lib/nativeShare.ts`) in the other direction.

---

## Tier 2 — depth on what already exists

### 6. Offline-first sync
The app is a hosted shell, so it is dead without a connection — a plane is the
worst place for a packing list. Local cache + background sync would make the app
work in flight, which is *also* a 4.2 argument because a website genuinely
cannot do it. This is probably the largest single engineering lift on this list.

### 7. Per-bag claim export → PDF with photos
Bags shipped in 0.7.2 with a manifest and timestamped export planned. Adding
photos of contents turns it into an actual lost-luggage claim packet. Note photos
were deferred deliberately — revisit with a concrete airline requirement.

### 8. Travel documents vault
Passport / visa / insurance / vaccination records attached per traveller, stored
encrypted. Raises the stakes sharply: this is the kind of thing that makes
5.1.1 and data-retention questions matter much more, so plan the privacy story
before the code.

### 9. Weight & dimensions budget
Track per-bag weight against an allowance and warn before check-in. Pairs
naturally with the existing bag kinds, which already carry hints.

### 10. Collaborative trips
Multiple accounts editing one trip in real time. The permission and scoping
layers already exist and were recently hardened for exactly this. High value,
high complexity, and it makes the invite-only model less limiting.

---

## Tier 3 — polish and reach

### 11. Trip templates
Save a trip's structure as a reusable template — the bag-import work in 0.7.2 is
most of the machinery.

### 12. Calendar integration
Export itinerary stops as Calendar events; show a trip's span on a month view.

### 13. Apple Watch companion
Next itinerary item and packing check-off from the wrist. Narrow but genuinely
native.

### 14. iPad layout
The packing grid is already two-column at `lg:`. A proper iPad split view would
be mostly layout work, and "runs well on iPad" is a low-cost review signal.

### 15. Multi-currency expense tracking
Per-trip budget with currency conversion. Careful: this edges toward finance,
which carries App Store rules of its own.

---

## Explicitly not doing

Recording these so they are not re-proposed:

- **In-app purchase / subscription.** 3.1.1 only applies if the app sells
  something. The invite-only model means it does not, and adding billing would
  turn a simple review into a complicated one. Revisit only if the app goes
  public.
- **Public sign-up.** Deliberate. The invite model avoids the whole 5.1.1
  account-flow surface.
- **Third-party sign-in.** Would trigger the Sign in with Apple requirement.
  Nothing needs it.

---

## How to sequence this

If the goal is the smoothest possible 1.0 review: ship as-is, then do **1 and 2**
first — Live Activities and Widgets are the cheapest, most visible native proof,
and both are well-trodden. Do 3 next because the Foundation Models groundwork is
already in place.

If the goal is the best product: **6 (offline)** is the one users will actually
feel. It is also the biggest lift and the most likely to destabilise a working
app, so it is a post-1.0 project, not a pre-1.0 one.
