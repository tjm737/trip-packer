import Foundation

/*
 * Native client for the existing TripPlanner HTTP API.
 *
 * This is deliberately a *client*, not a second implementation. The server
 * stays the single source of truth for permissions and persistence, and the
 * native screen reads and writes through exactly the same endpoints the web
 * app uses (`GET /api/state`, `POST /api/mutate`). The alternative -- a native
 * local store with its own sync rules -- would fork the data model and mean
 * every future field change had to be made twice, with the two copies free to
 * disagree in between.
 *
 * Auth reuses the webview's session cookie. `URLSessionConfiguration`
 * `.shared` on iOS reads the shared `HTTPCookieStorage`, which the Capacitor
 * WKWebView also writes to, so a user who has signed in through the web layer
 * is already authenticated here. That is why this file has no login code: the
 * native surface piggybacks on the session the web app established, and adding
 * a second credential path would be a second thing to keep secure.
 */

/// Mirrors `AppState` from src/lib/types.ts. Only the fields the packing screen
/// needs are declared; the rest of the payload is ignored by Codable.
///
/// Deliberately not exhaustive: declaring every field would mean a server-side
/// addition could break decoding here. Decoding only what is used keeps the
/// native client tolerant of the API growing.
struct TPState: Codable {
    var trips: [TPTrip]
    var categories: [TPCategory]
    var items: [TPItem]
    /// Optional, not required, even though the server always sends it.
    ///
    /// A required array would make every older cached payload fail to decode
    /// whole, so a client that briefly predates this field would show an empty
    /// app rather than a trip without bags. Optional degrades to "no bags",
    /// which is a state the UI already renders.
    var bags: [TPBag]?
}

struct TPTrip: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var destination: String
}

struct TPCategory: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var icon: String?
    var order: Int?
}

/// A bag: the physical container a trip's items travel in.
///
/// A second axis, not another category. Category answers "what kind of thing is
/// it", bag answers "where is it right now" — the same t-shirt is Clothing AND
/// in the black carry-on. Mirrors `Bag` in src/lib/types.ts.
///
/// `tagNumber` and `notes` are plain strings rather than optionals because that
/// is what the API sends (empty string when unknown); making them optional here
/// would mean two spellings of "absent" and a decoder that has to accept both.
struct TPBag: Codable, Identifiable, Hashable {
    var id: String
    var tripId: String
    var name: String
    var kind: String
    var tagNumber: String
    var notes: String
    /*
     * createdAt / updatedAt are REQUIRED by the server's insertBag, which binds
     * eight named parameters and throws a RangeError on any missing one:
     *
     *   INSERT INTO bags (id, tripId, name, kind, tagNumber, notes,
     *                     createdAt, updatedAt) VALUES (...)
     *
     * better-sqlite3 raises `Missing named parameter "createdAt"` at bind time,
     * which surfaces as an uncaught throw and therefore HTTP 500 -- the client
     * only sees "Server responded with 500", with nothing naming the cause.
     *
     * They are stamped CLIENT-side, matching src/lib/storage.ts:506-507 where
     * both are set to the same `now`. The server does not default them, so a
     * client that omits them fails rather than getting a server timestamp.
     */
    var createdAt: String
    var updatedAt: String
}

/// ISO 8601 with fractional seconds, matching JavaScript's `Date.toISOString()`.
///
/// `ISO8601DateFormatter()` with default options emits `2026-09-21T14:13:20Z`
/// (no milliseconds), while the web client sends `...20.123Z`. Both parse, so a
/// mismatch raises nothing -- it just means native- and web-created rows carry
/// different precision and sort inconsistently within the same second. The
/// explicit formatOptions is the difference, and it is required for parity.
let tpNow: () -> String = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
}

/// How many suggestions to ask the on-device model for. Mirrors MAX_SUGGESTIONS
/// in src/lib/packingSuggestions.ts.
///
/// Duplicated rather than fetched because there is no path from native code to
/// a TypeScript constant at runtime. If the web value changes, the native
/// prompt and the web prompt diverge, so change both together.
let kMaxSuggestions = 12

struct TPItem: Codable, Identifiable, Hashable {
    var id: String
    var tripId: String
    var categoryId: String
    var name: String
    var quantity: Int
    var checked: Bool
    /// Per-item emoji, e.g. "🛂". Present in the API payload and shown by the
    /// web app, so it is decoded here too rather than guessed at.
    var icon: String?
    var order: Int
    /// Which bag this item is packed in. Optional because the API sends null
    /// for an unassigned item, and null honestly means "not in a bag yet".
    ///
    /// Required for the bag UI to work at all: without this field the item's
    /// bag would never round-trip, so assigning one would appear to succeed
    /// and then show nothing on the next load.
    var bagId: String?
}

/// The envelope both endpoints wrap their payload in.
private struct StateEnvelope: Codable {
    var state: TPState?
}

/*
 * Mutation ops, kept as an enum so a call site cannot invent a payload shape
 * the server will reject. The raw values match the string literals in
 * src/lib/reconcile.ts; if a case is added there, it must be added here too.
 *
 * `item.update` takes a PARTIAL item server-side (`updates: Partial<PackingItem>`
 * in reconcile.ts:63), so an edit only sends the fields the user changed. The
 * per-field cases below exist rather than one "send the whole item" case so a
 * rename cannot accidentally clobber a concurrent toggle: sending the whole
 * struct would carry a stale `checked` along with the new name and silently
 * revert whatever the other device just did.
 */
enum TPOp {
    case itemToggle(id: String, checked: Bool)
    case itemRename(id: String, name: String)
    case itemQuantity(id: String, quantity: Int)
    case itemCreate(TPItem)
    case itemDelete(id: String)
    /// Assign an item to a bag. `bagId` is the wire field, and nil is a
    /// meaningful value here rather than "leave unchanged": clearing an
    /// assignment is how an item leaves a bag, and the server distinguishes
    /// `null` (unassign) from an absent key (don't touch).
    case itemSetBag(id: String, bagId: String?)
    case bagCreate(TPBag)
    case bagRename(id: String, name: String, updatedAt: String)
    case bagDelete(id: String)

    var body: [String: Any] {
        switch self {
        case .itemToggle(let id, let checked):
            return ["op": "item.update", "id": id, "updates": ["checked": checked]]

        case .itemRename(let id, let name):
            return ["op": "item.update", "id": id, "updates": ["name": name]]

        case .itemQuantity(let id, let quantity):
            return ["op": "item.update", "id": id, "updates": ["quantity": quantity]]

        case .itemCreate(let item):
            return [
                "op": "item.create",
                "item": [
                    "id": item.id,
                    "tripId": item.tripId,
                    "categoryId": item.categoryId,
                    "name": item.name,
                    "quantity": item.quantity,
                    "checked": item.checked,
                    "icon": "",
                    "order": item.order,
                ],
            ]

        case .itemDelete(let id):
            return ["op": "item.delete", "id": id]

        case .itemSetBag(let id, let bagId):
            // NSNull, not a missing key. `["bagId": nil]` would drop the entry
            // from the dictionary entirely, which reads as "no change" and
            // leaves the item in a bag the user just asked to remove it from.
            //
            // Typed as Any explicitly: `bagId ?? NSNull()` does not typecheck,
            // because ?? requires both sides to be the same type and String?
            // and NSNull are not. Widening first makes the nil branch legal.
            let value: Any = bagId ?? NSNull()
            return [
                "op": "item.update",
                "id": id,
                "updates": ["bagId": value],
            ]

        case .bagCreate(let bag):
            return [
                "op": "bag.create",
                "bag": [
                    "id": bag.id,
                    "tripId": bag.tripId,
                    "name": bag.name,
                    "kind": bag.kind,
                    "tagNumber": bag.tagNumber,
                    "notes": bag.notes,
                    // Must be sent: see the note on TPBag. Omitting either one
                    // makes the server throw at bind time and return 500.
                    "createdAt": bag.createdAt,
                    "updatedAt": bag.updatedAt,
                ],
            ]

        case .bagRename(let id, let name, let updatedAt):
            return [
                "op": "bag.update",
                "id": id,
                "updates": ["name": name, "updatedAt": updatedAt],
            ]

        case .bagDelete(let id):
            return ["op": "bag.delete", "id": id]
        }
    }
}

enum TPError: LocalizedError {
    case notAuthenticated
    case http(Int)
    case malformed

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Not signed in. Open the web app and sign in first."
        case .http(let code):
            return "Server responded with \(code)."
        case .malformed:
            return "Could not read the server response."
        }
    }
}

actor TPClient {
    static let shared = TPClient()

    /// Points at production by default, matching capacitor.config.ts. Overridable
    /// so the screen can be exercised against a local server during development.
    private let baseURL: URL

    init(baseURL: URL = URL(string: ProcessInfo.processInfo.environment["TRIP_PACKER_URL"]
                            ?? "https://trips.planetracker.app")!) {
        self.baseURL = baseURL
    }

    func fetchState() async throws -> TPState {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/state"))
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw TPError.malformed }
        // 401 is distinguished from other failures because it is the one the
        // user can act on: they need to sign in through the web layer.
        if http.statusCode == 401 { throw TPError.notAuthenticated }
        guard http.statusCode == 200 else { throw TPError.http(http.statusCode) }

        guard let envelope = try? JSONDecoder().decode(StateEnvelope.self, from: data),
              let state = envelope.state else { throw TPError.malformed }
        return state
    }

    func mutate(_ op: TPOp) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/mutate"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: op.body)

        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw TPError.malformed }
        if http.statusCode == 401 { throw TPError.notAuthenticated }
        guard (200..<300).contains(http.statusCode) else { throw TPError.http(http.statusCode) }
    }
}
