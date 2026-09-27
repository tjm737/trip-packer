import SwiftUI

/*
 * Native trip itinerary: the reservations a trip is made of.
 *
 * READ-ONLY for this pass, deliberately. The web itinerary can add, edit,
 * reorder and delete; none of that is here. The point is to prove the native
 * read path on a shape the native client has not decoded before -- `TPState`
 * has never carried reservations -- because a decode failure is the one thing
 * that would take the whole screen down. Editing is a second pass on top of a
 * foundation that is known to load.
 *
 * Structured to match PackingListView: same ZStack/surface0 backdrop, same
 * loading -> error -> content progression, same ContentUnavailableView for a
 * load failure with a Try Again action, same toolbar treatment. Consistency
 * here is not cosmetic -- these are two screens in one app, and a user moving
 * between them should not have to relearn the chrome.
 */

/// Loads state and exposes the ordered itinerary for one trip.
@MainActor
final class TripItineraryModel: ObservableObject {
    @Published private(set) var state: TPState?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            state = try await TPClient.shared.fetchState()
            errorMessage = nil
        } catch {
            /*
             * Keep any previously loaded state on screen. A refresh that fails
             * should not blank out an itinerary the user was reading -- the
             * error is surfaced, but stale content beats no content here.
             *
             * The error text comes from TPError's LocalizedError conformance,
             * which distinguishes "not signed in" (the one the user can act on)
             * from an HTTP status or a malformed response.
             */
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func trip(_ id: String) -> TPTrip? {
        state?.trips.first { $0.id == id }
    }

    /// This trip's reservations, in itinerary order, grouped by day.
    func days(for tripId: String) -> [(day: String, items: [TPReservation])] {
        guard let all = state?.reservations else { return [] }
        return TPItinerary.byDay(all.filter { $0.tripId == tripId })
    }
}

struct TripItineraryView: View {
    let tripId: String
    /// Dismisses the native screen. Required, not optional-in-practice: a
    /// presented screen with no way back is a trap.
    var onClose: (() -> Void)?

    @StateObject private var model = TripItineraryModel()

    var body: some View {
        ZStack {
            TPTheme.surface0.ignoresSafeArea()

            Group {
                if model.isLoading && model.state == nil {
                    ProgressView("Loading itinerary")
                        .tint(TPTheme.textSecondary)
                        .foregroundStyle(TPTheme.textSecondary)
                } else if let message = model.errorMessage, model.state == nil {
                    ContentUnavailableView {
                        Label("Could not load", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try Again") { Task { await model.load() } }
                            .buttonStyle(.borderedProminent)
                            .tint(TPTheme.primary)
                    }
                } else {
                    content
                }
            }
        }
        .navigationTitle(model.trip(tripId)?.name ?? "Itinerary")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                if let onClose {
                    Button("Done", action: onClose)
                        .foregroundStyle(TPTheme.textSecondary)
                }
            }
            // Refresh is a toolbar button rather than `.refreshable`, matching
            // PackingListView. `.refreshable` installs a pull-to-refresh
            // gesture that competes with the scroll view's own pan and was
            // removed there for breaking scrolling; the same applies here.
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.load() }
                } label: {
                    if model.isLoading {
                        ProgressView().tint(TPTheme.textSecondary)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(TPTheme.textSecondary)
                    }
                }
                .disabled(model.isLoading)
                .accessibilityLabel("Refresh itinerary")
            }
        }
        .toolbarBackground(TPTheme.surface0, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        let days = model.days(for: tripId)

        if days.isEmpty {
            /*
             * Empty is a legitimate state, not an error: a trip that has just
             * been created has no bookings yet. Rendering the same "Could not
             * load" treatment here would tell the user something was broken
             * when nothing is.
             */
            ContentUnavailableView {
                Label("No reservations", systemImage: "calendar")
            } description: {
                Text("Bookings added to this trip will appear here.")
            }
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(days, id: \.day) { group in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(TPItinerary.dayHeading(group.day))
                                .font(.system(size: 11, weight: .semibold))
                                .tracking(0.9)
                                .textCase(.uppercase)
                                .foregroundStyle(TPTheme.textMuted)

                            ForEach(group.items) { reservation in
                                ReservationCard(reservation: reservation)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
        }
    }
}

/// One reservation. Mirrors the web card: type icon, title, confirmation and
/// cost on one line, then the locations and the when-label.
private struct ReservationCard: View {
    let reservation: TPReservation

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: reservation.kind.symbol)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(TPTheme.primary)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 3) {
                    /*
                     * An untitled reservation falls back to its type label
                     * rather than rendering an empty row. The web does the same:
                     * a card with no title is still a booking, and a blank line
                     * reads as a rendering bug.
                     */
                    Text(reservation.title.isEmpty ? reservation.kind.label : reservation.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(TPTheme.textPrimary)

                    /*
                     * Unconfirmed bookings are marked and de-emphasised. This is
                     * the whole reason `confirmed` is stored separately from
                     * `confirmation`: having a reference code does not mean the
                     * booking is settled, and a maybe should not look as solid
                     * as a done deal.
                     */
                    if !reservation.confirmed {
                        Text("Unconfirmed")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(TPTheme.textMuted)
                    }
                }

                Spacer(minLength: 8)

                if !reservation.cost.isEmpty {
                    Text(reservation.cost)
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundStyle(TPTheme.textSecondary)
                }
            }

            // Journey endpoints, only for types that actually travel. Lodging
            // and cars leave `locationTo` empty, so the arrow never renders for
            // them -- and a lone location is rendered as a plain line rather
            // than "X → ".
            if !reservation.location.isEmpty || !reservation.locationTo.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 11))
                        .foregroundStyle(TPTheme.textMuted)

                    if reservation.locationTo.isEmpty {
                        Text(reservation.location)
                            .font(.system(size: 13))
                            .foregroundStyle(TPTheme.textSecondary)
                    } else {
                        Text("\(reservation.location) → \(reservation.locationTo)")
                            .font(.system(size: 13))
                            .foregroundStyle(TPTheme.textSecondary)
                    }
                }
            }

            let when = TPItinerary.whenLabel(reservation)
            if !when.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 11))
                        .foregroundStyle(TPTheme.textMuted)
                    Text(when)
                        .font(.system(size: 13))
                        .foregroundStyle(TPTheme.textSecondary)
                }
            }

            if !reservation.confirmation.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "number")
                        .font(.system(size: 11))
                        .foregroundStyle(TPTheme.textMuted)
                    Text(reservation.confirmation)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(TPTheme.textMuted)
                }
            }

            if !reservation.notes.isEmpty {
                Text(reservation.notes)
                    .font(.system(size: 13))
                    .foregroundStyle(TPTheme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TPTheme.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(TPTheme.hairline.opacity(0.6), lineWidth: 1)
        )
    }
}
