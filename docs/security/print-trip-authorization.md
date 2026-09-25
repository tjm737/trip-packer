# VULNERABILITY: /trips/[id]/print discloses any trip to any authenticated user

**Severity: high.** Any logged-in account can read any other user's full itinerary,
including names, destinations, dates, reservations, tasks and packing contents, by
requesting `/trips/<id>/print` with a trip id they do not own.

## Root cause

`src/app/trips/[id]/print/page.tsx` guards with `hasValidSession()` only:

```ts
if (!(await hasValidSession())) {
  redirect(`/login?from=${encodeURIComponent(`/trips/${id}/print`)}`);
}

const state = readState();            // <-- UNSCOPED: every user's rows
const trip = state?.trips.find((t) => t.id === id);
```

`hasValidSession()` answers "does a plausible session exist", not "may this session
read this trip". `readState()` returns the whole database with no per-user filter.
The API's equivalent path (`src/app/api/state/route.ts:36`) does not have this hole
because it passes the state through `scopeStateForUser(state, actor.id)` first.

The middleware (`src/proxy.ts`, matcher `/trips/:path*`) only checks for cookie
*presence*, so it does not bound this either. The in-file comment claims the guard
is "the only thing standing between a guessed trip id and the itinerary" — it is,
and it is insufficient.

## Reproduction (verified 2026-09-25, dev server on a scratch copy of the DB)

1. Copy `data/trip-packer.db` to `/tmp/tp-leak-test.db`.
2. Insert a second account ("Mallory") plus a session row whose `tokenHash` is
   `sha256(raw)`, matching `hashSessionToken` in `src/lib/session.ts`.
3. Start a dev server against that DB:
   `TRIP_PACKER_DB=/tmp/tp-leak-test.db npx next dev -p 3111`
4. Sanity check that Mallory's session is genuinely valid — her own trip returns 200.
5. Request a trip owned by a *different* user with Mallory's cookie.

## Observed result

```
GET /trips/attacker-trip-.../print   (Mallory's own)      -> 200   [session is valid]
GET /trips/bbbd5bdb-.../print        (Tyler's, NOT hers)  -> 200   [LEAK]
  <title>Iceland Ring Road — Itinerary</title>
  body: 40540 bytes, print-sheet present, 68 print-item blocks, 4 print-section blocks
  "Iceland Ring Road" x6, "Reykjav" x6, "Blue Lagoon" x2
```

A 307 would have meant the request was refused. It returned a fully rendered
document instead, so the leak is in the body and not merely the title.

Note: a 307 response is NOT proof of safety on its own. The forged-cookie request
that returned 307 earlier was rejected because the DB being read did not contain
the forged session row — not because the disclosure was blocked. Always confirm the
server under test is reading the database you populated.

## Correct fix

Scope the read to the acting user and 404 on a trip they cannot see, mirroring
`scopeStateForUser`. The same scoping must be applied inside `generateMetadata`,
which runs independently and resolves BEFORE the body's redirect — otherwise the
trip name still leaks via `<title>` even though the body is guarded.

## Related surface to audit

The same "valid session but no ownership check" shape should be checked on any other
direct-`readState()` page. `/trips/[id]/print` is the one found here. `/share/[token]`
is token-gated by design. `/api/state` is correctly scoped.
