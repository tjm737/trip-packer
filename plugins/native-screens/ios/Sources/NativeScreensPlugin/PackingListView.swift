import SwiftUI

/*
 * Native packing list.
 *
 * The first screen migrated off the webview. Chosen as the proof because it is
 * a bounded surface -- one trip's items, grouped by category, each independently
 * checkable -- and because it pairs with the on-device suggestions feature that
 * carries the app's App Store argument. If this screen is right, the same shape
 * applies to the rest.
 *
 * State handling is optimistic on toggle: the row updates immediately and the
 * request follows, reverting on failure. The alternative -- awaiting every tap
 * before showing it -- makes a checklist feel broken over a slow connection,
 * and a checklist is a thing users tap rapidly.
 */

@MainActor
final class PackingListModel: ObservableObject {
    @Published private(set) var state: TPState?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    /// Item ids with an in-flight toggle, so the row can show it is working and
    /// a double-tap cannot send two conflicting updates for the same item.
    @Published private(set) var pending: Set<String> = []

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            state = try await TPClient.shared.fetchState()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func items(for tripId: String, in categoryId: String) -> [TPItem] {
        (state?.items ?? [])
            .filter { $0.tripId == tripId && $0.categoryId == categoryId }
            .sorted { $0.order < $1.order }
    }

    /// Categories that actually hold items for this trip, so an empty category
    /// is not rendered as a heading with nothing under it.
    func categories(for tripId: String) -> [TPCategory] {
        let used = Set((state?.items ?? []).filter { $0.tripId == tripId }.map(\.categoryId))
        return (state?.categories ?? [])
            .filter { used.contains($0.id) }
            .sorted { ($0.order ?? 0) < ($1.order ?? 0) }
    }

    func trip(_ tripId: String) -> TPTrip? {
        state?.trips.first { $0.id == tripId }
    }

    /// Toggles locally, then persists. Reverts the local flip if the write
    /// fails, because a checklist that silently lies about what is packed is
    /// worse than one that shows an error.
    func toggle(_ item: TPItem) async {
        guard !pending.contains(item.id) else { return }
        guard let current = state,
              let idx = current.items.firstIndex(where: { $0.id == item.id }) else { return }

        let newValue = !current.items[idx].checked
        pending.insert(item.id)
        state?.items[idx].checked = newValue

        do {
            try await TPClient.shared.mutate(.itemUpdate(id: item.id, checked: newValue))
        } catch {
            state?.items[idx].checked = !newValue
            errorMessage = error.localizedDescription
        }
        pending.remove(item.id)
    }
}

struct PackingListView: View {
    let tripId: String
    /// Dismisses the native screen. Presenting a screen with no way back is a
    /// trap, so the close control is a required part of the view rather than
    /// something the presenter adds around it.
    var onClose: (() -> Void)?

    @StateObject private var model = PackingListModel()

    var body: some View {
        Group {
            if model.isLoading && model.state == nil {
                ProgressView("Loading packing list")
            } else if let message = model.errorMessage, model.state == nil {
                // Deliberately not ContentUnavailableView: that needs iOS 17 and
                // this target supports iOS 15. Raising the deployment target for
                // one empty state would drop devices the app otherwise supports,
                // so the state is built from primitives available at 15.
                EmptyStateView(
                    icon: "exclamationmark.triangle",
                    title: "Could not load",
                    message: message,
                    actionTitle: "Try Again",
                    action: { Task { await model.load() } }
                )
            } else {
                list
            }
        }
        .navigationTitle(model.trip(tripId)?.name ?? "Packing")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if let onClose {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done", action: onClose)
                }
            }
        }
        .task { await model.load() }
    }

    private var list: some View {
        List {
            ForEach(model.categories(for: tripId), id: \.id) { category in
                Section(category.name) {
                    ForEach(model.items(for: tripId, in: category.id), id: \.id) { item in
                        PackingRow(
                            item: item,
                            isPending: model.pending.contains(item.id),
                            onToggle: { Task { await model.toggle(item) } }
                        )
                    }
                }
            }
        }
        .refreshable { await model.load() }
        .overlay {
            if model.categories(for: tripId).isEmpty {
                EmptyStateView(
                    icon: "suitcase",
                    title: "Nothing to pack yet",
                    message: "Add items in the app and they will appear here."
                )
            }
        }
    }
}

/// A centred icon / title / message block, optionally with one action.
///
/// Exists because `ContentUnavailableView` requires iOS 17 while this target
/// supports iOS 15. Declared once and reused rather than inlined twice, so the
/// two empty states cannot drift apart visually.
private struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 42))
                .foregroundStyle(.secondary)

            Text(title)
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct PackingRow: View {
    let item: TPItem
    let isPending: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(item.checked ? Color.accentColor : Color.secondary)

                Text(item.name)
                    .strikethrough(item.checked, color: .secondary)
                    .foregroundStyle(item.checked ? Color.secondary : Color.primary)

                Spacer()

                // Quantity only shown when it says something a bare row would
                // not: "Passport x1" is noise, "Battery x4" is information.
                if item.quantity > 1 {
                    Text("x\(item.quantity)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isPending)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.name)\(item.quantity > 1 ? ", quantity \(item.quantity)" : "")")
        .accessibilityValue(item.checked ? "Packed" : "Not packed")
        .accessibilityHint("Double tap to toggle")
    }
}
