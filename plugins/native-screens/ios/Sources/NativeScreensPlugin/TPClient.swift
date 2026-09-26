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
}

/// The envelope both endpoints wrap their payload in.
private struct StateEnvelope: Codable {
    var state: TPState?
}

/*
 * Mutation ops, kept as an enum so a call site cannot invent a payload shape
 * the server will reject. The raw values match the string literals in
 * src/lib/reconcile.ts; if a case is added there, it must be added here too.
 */
enum TPOp {
    case itemUpdate(id: String, checked: Bool)
    case itemCreate(TPItem)

    var body: [String: Any] {
        switch self {
        case .itemUpdate(let id, let checked):
            return ["op": "item.update", "id": id, "updates": ["checked": checked]]
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
