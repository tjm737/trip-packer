import Foundation

/*
 * Trip itinerary: the reservations a trip is made of, in the order the web app
 * shows them.
 *
 * Deliberately read-only for now. The web itinerary can add, edit, reorder and
 * delete reservations, and none of that is here -- the point of this pass is to
 * prove the native read path on a data shape the native client has not decoded
 * before. Editing brings date pickers, the type taxonomy, and drag semantics,
 * and doing both at once would mean a failure could be in either half.
 *
 * The ordering rule is a PORT, not a reimplementation. It mirrors
 * src/lib/itineraryOrder.ts, which is the single source of truth, and that file
 * survives three specific bugs that a naive port would reintroduce. They are
 * documented at each step below because the failure modes are silent -- they
 * produce a plausible-looking order, not an error.
 */

/// Mirrors `Reservation` in src/lib/types.ts. Only the fields the read-only
/// screen renders are declared.
///
/// Field-by-field parity matters more than completeness here: `startDate` and
/// `startTime` are LOCAL wall-clock strings ("2026-10-21", "09:20"), not
/// instants. Parsing them into `Date` would look tidier and would be wrong --
/// a departure time is local to wherever the traveller is standing, and turning
/// it into an instant silently shifts it across timezones. They are compared as
/// strings, which is exactly what the web does and is correct for this format
/// (zero-padded ISO date and 24h zero-padded time both sort lexically).
struct TPReservation: Codable, Identifiable, Hashable {
    var id: String
    var tripId: String
    /// "flight" | "lodging" | "car" | "train" | "ferry" | "activity" | "other".
    ///
    /// A String rather than an enum: the server is free to add a type, and an
    /// enum would make an unknown value fail to decode the WHOLE reservation --
    /// turning a new booking type into a blank screen. `TPReservationType`
    /// resolves it for display and falls back to `.other`.
    var type: String
    var title: String
    /// Booking reference, the thing you show at a desk. May be empty.
    var confirmation: String
    var confirmed: Bool
    /// Departure point. For non-flights this is just the place.
    var location: String
    /// Arrival point. Empty for anything that is not a journey.
    var locationTo: String
    /// "YYYY-MM-DD" or "".
    var startDate: String
    /// "HH:MM" (24h) or "".
    var startTime: String
    var endDate: String
    var endTime: String
    /// Free-text, e.g. "412.50 USD". Not a number: currency varies.
    var cost: String
    var notes: String
    /// Insertion counter. NOT a user-chosen position -- see `orderManual`.
    var order: Int
    /// nil means the user has never dragged this trip's itinerary, so `order`
    /// is meaningless and dates decide the sequence. Non-nil means they HAVE
    /// dragged, and `order` wins for the rows they placed.
    var orderManual: Int?

    /// Resolved type for icon and label. Unknown types render as a plain booking
    /// rather than failing.
    var kind: TPReservationType { TPReservationType(rawValue: type) ?? .other }
}

enum TPReservationType: String {
    case flight, lodging, car, train, ferry, activity, other

    /// Matches TYPE_META in src/components/SharedTripView.tsx.
    var label: String {
        switch self {
        case .flight: return "Flight"
        case .lodging: return "Stay"
        case .car: return "Car"
        case .train: return "Train"
        case .ferry: return "Ferry"
        case .activity: return "Activity"
        case .other: return "Booking"
        }
    }

    /// SF Symbols stand-in for the lucide icon the web uses.
    var symbol: String {
        switch self {
        case .flight: return "airplane"
        case .lodging: return "bed.double"
        case .car: return "car"
        case .train: return "tram"
        case .ferry: return "ferry"
        case .activity: return "ticket"
        case .other: return "calendar"
        }
    }
}

/*
 * Ordering, ported from `inItineraryOrder` in src/lib/itineraryOrder.ts.
 *
 * The web builds this as: sort by date, then lift out rows the user dragged and
 * re-insert them at their rank. Two passes, because a rank is an adjustment
 * applied over the date order rather than a key to sort by -- dragging the 9th
 * row to the top moves that row and leaves the rest alone relative to each
 * other, which a plain sort cannot express.
 *
 * Rows with neither a date nor a location are DROPPED, matching the web
 * itinerary's filter. An undated booking that at least names a place is kept
 * and sorted to the end -- it is a real booking the user is still filling in --
 * but a row with no date and no place has nothing to show and is not rendered.
 */
enum TPItinerary {
    static func ordered(_ reservations: [TPReservation]) -> [TPReservation] {
        /*
         * Whether a row carries a user-chosen position.
         *
         * `orderManual != nil` -- and NOT `order`. This is the first of the three
         * bugs the web file documents. `order` is an insertion counter that every
         * insert increments, so treating it as a manual position marks EVERY row
         * as dragged and lets the importer's file order decide the list. On the
         * web that drew a road from London to Munich across a trip that had a
         * flight in it.
         */
        func isManual(_ r: TPReservation) -> Bool { r.orderManual != nil }

        // `rank` is the row's stored `order`. It is only ever *consulted* for
        // rows where `touched` is true, so the insertion-counter value carried
        // by an undragged row can never position anything.
        let items = reservations.map { (r: TPReservation) -> (r: TPReservation, rank: Int, touched: Bool) in
            (r: r, rank: r.order, touched: isManual(r))
        }

        /*
         * Drop rows with neither a date nor a location.
         *
         * Mirrors the web's `.filter(... r.startDate || r.location)`. A
         * reservation with no date and no place is not yet a thing that can be
         * sequenced or shown -- it has no position in time and no position on a
         * map -- so the web itinerary does not render it, and neither may this
         * screen, or the phone would show a booking the web hides.
         *
         * NOTE the interaction with the rule below: this test runs BEFORE the
         * undated-sink sort, so "undated sinks" applies only to rows that
         * survived here (i.e. have a location but no date).
         */
        let visible = items.filter { !$0.r.startDate.isEmpty || !$0.r.location.isEmpty }

        /*
         * Pass 1: date order, which is what a user who has never dragged sees.
         *
         * Two rules here, both load-bearing:
         *
         *   - Undated rows sink. A record still missing a date must never push a
         *     confirmed flight down the list.
         *
         *   - Within one date, a row WITH a time sorts before one without. This
         *     is the second documented bug. An untimed booking makes no claim
         *     about when it happens, so it cannot be said to precede a departure
         *     with a specific clock time -- but "" compares below every "HH:MM",
         *     so letting the empty string sort first made it do exactly that.
         *
         * The final tiebreak is by id, so the order is total and stable; without
         * it two rows with no date and no time could swap between loads.
         */
        let byDate = visible.sorted { a, b in
            let aD = a.r.startDate
            let bD = b.r.startDate
            if !aD.isEmpty, !bD.isEmpty, aD != bD { return aD < bD }
            if !aD.isEmpty, bD.isEmpty { return true }
            if aD.isEmpty, !bD.isEmpty { return false }

            let aT = a.r.startTime
            let bT = b.r.startTime
            let aHas = !aT.isEmpty
            let bHas = !bT.isEmpty
            if aHas != bHas { return aHas }
            if aT != bT { return aT < bT }
            return a.r.id < b.r.id
        }

        /*
         * Pass 2: lift the dragged rows and re-insert them at their rank.
         *
         * Insertion order is by rank, each clamped to the list it is entering --
         * a rank can exceed the list length (a row dragged below everything else
         * from a shorter list), and clamping is what keeps `insert` in range.
         *
         * Ties break by the row's position in the date-sorted list, matching the
         * web's `a.dateIdx - b.dateIdx`. Returning false for a tie (the obvious
         * shortcut) is not a strict weak ordering -- two rows sharing a rank
         * would come out in an arbitrary, unstable order.
         */
        let dateIdx = Dictionary(uniqueKeysWithValues: byDate.enumerated().map { ($0.element.r.id, $0.offset) })

        var ordered = byDate.filter { !$0.touched }.map(\.r)
        let lifted = byDate.filter(\.touched).sorted { a, b in
            if a.rank != b.rank { return a.rank < b.rank }
            return (dateIdx[a.r.id] ?? 0) < (dateIdx[b.r.id] ?? 0)
        }

        for item in lifted {
            let at = max(0, min(ordered.count, item.rank))
            ordered.insert(item.r, at: at)
        }

        return ordered
    }

    /*
     * Group for display under day headings.
     *
     * Dates are the raw "YYYY-MM-DD" strings, deliberately not reformatted into
     * `Date` -- that would reintroduce the timezone shift the model avoids. The
     * heading is rendered from the string by `TPItinerary.dayHeading`.
     *
     * Returns groups in itinerary order so manual drags that cross days keep
     * their effect, rather than being re-sorted back into date order here.
     */
    static func byDay(_ reservations: [TPReservation]) -> [(day: String, items: [TPReservation])] {
        var groups: [(day: String, items: [TPReservation])] = []
        for r in ordered(reservations) {
            let day = r.startDate
            if let last = groups.last, last.day == day {
                groups[groups.count - 1].items.append(r)
            } else {
                groups.append((day: day, items: [r]))
            }
        }
        return groups
    }

    /// "2026-10-21" -> "Oct 21". Empty date -> "No date".
    ///
    /// Parsed by hand rather than with a DateFormatter. The input is a local
    /// date with no timezone; a formatter would apply one and could land the
    /// heading on the previous day for a user east of the server.
    static func dayHeading(_ isoDate: String) -> String {
        let parts = isoDate.split(separator: "-")
        guard parts.count == 3,
              let month = Int(parts[1]),
              let day = Int(parts[2]),
              (1...12).contains(month)
        else { return isoDate.isEmpty ? "No date" : isoDate }

        let names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return "\(names[month - 1]) \(day)"
    }

    /// "09:20" -> "9:20 AM". Empty stays empty.
    ///
    /// Mirrors the web's 12-hour display. Also parsed by hand: a DateFormatter
    /// would need a date attached to have anything to format.
    static func timeLabel(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]),
              (0...23).contains(h)
        else { return hhmm }

        let suffix = h < 12 ? "AM" : "PM"
        // 0 -> 12, 13 -> 1. `% 12` alone turns noon into 0.
        let hour12 = h % 12 == 0 ? 12 : h % 12
        return String(format: "%d:%02d %@", hour12, m, suffix)
    }

    /// A "Oct 21 · 9:20 AM → Oct 21 · 3:00 PM" line, collapsing what is absent.
    ///
    /// Built from the pieces that exist rather than from a formatter, because a
    /// reservation may legitimately have a date and no time (a hotel check-in
    /// day), a time and no date (rare but representable), or neither.
    static func whenLabel(_ r: TPReservation) -> String {
        var start = dayHeading(r.startDate)
        if !r.startTime.isEmpty { start += " · " + timeLabel(r.startTime) }
        if r.startDate.isEmpty && r.startTime.isEmpty { start = "" }

        // A single-day booking does not need its end date repeated -- "Oct 21"
        // twice reads as noise. Only show the end when it differs.
        let endDiffers = !r.endDate.isEmpty && r.endDate != r.startDate
        guard endDiffers || !r.endTime.isEmpty else { return start }

        var end = endDiffers ? dayHeading(r.endDate) : ""
        if !r.endTime.isEmpty {
            end += (end.isEmpty ? "" : " · ") + timeLabel(r.endTime)
        }
        if start.isEmpty { return end }
        return "\(start) → \(end)"
    }
}
