import SwiftUI

/*
 * Native packing list, styled to match the web app rather than to look like iOS.
 *
 * The first version used a stock SwiftUI List: system separators, .accentColor,
 * default section headers. It read as a different product than the web screen it
 * mirrors, which defeated the point of the pilot -- the question was whether
 * native feels better than the webview, and a screen styled for the wrong design
 * language cannot answer that.
 *
 * Everything here is mirrored from the web implementation in
 * src/app/(app)/trips/[id]/page.tsx:
 *   CategorySection   rounded-xl card, zinc-900/80 fill, zinc-800 hairline,
 *                     emoji + name + "N/M" count, collapse chevron
 *   PackingItemRow    emerald checkbox when packed, emerald-500/5 row tint,
 *                     per-item emoji, line-through on checked
 *
 * Deliberately NOT a `List`. The web equivalent is a stack of rounded cards with
 * gaps between them, and `List` insists on full-bleed rows with separators. The
 * visual difference is the whole complaint, so the container is a ScrollView.
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
        ZStack {
            TPTheme.surface0.ignoresSafeArea()

            Group {
                if model.isLoading && model.state == nil {
                    ProgressView("Loading packing list")
                        .tint(TPTheme.textSecondary)
                        .foregroundStyle(TPTheme.textSecondary)
                } else if let message = model.errorMessage, model.state == nil {
                    // Deliberately not ContentUnavailableView: that needs iOS 17
                    // and this target supports iOS 15. Raising the deployment
                    // target for one empty state would drop devices the app
                    // otherwise supports, so the state is built from primitives
                    // available at 15.
                    EmptyStateView(
                        icon: "exclamationmark.triangle",
                        title: "Could not load",
                        message: message,
                        actionTitle: "Try Again",
                        action: { Task { await model.load() } }
                    )
                } else {
                    content
                }
            }
        }
        .navigationTitle(model.trip(tripId)?.name ?? "Packing")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if let onClose {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done", action: onClose)
                        .foregroundStyle(TPTheme.textSecondary)
                }
            }
        }
        // No .toolbarBackground here: it needs iOS 16 and this target supports
        // iOS 15. The nav bar keeps its default material, which reads as native
        // chrome above the dark content rather than as a styling mistake.
        .preferredColorScheme(.dark)
        .task { await model.load() }
    }

    private var content: some View {
        ScrollView {
            VStack(spacing: 12) {
                if model.categories(for: tripId).isEmpty {
                    EmptyStateView(
                        icon: "suitcase",
                        title: "Nothing to pack yet",
                        message: "Add items in the app and they will appear here."
                    )
                    .padding(.top, 60)
                } else {
                    ForEach(model.categories(for: tripId), id: \.id) { category in
                        CategoryCard(
                            category: category,
                            items: model.items(for: tripId, in: category.id),
                            pending: model.pending,
                            onToggle: { item in Task { await model.toggle(item) } }
                        )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .refreshable { await model.load() }
    }
}

/// One category, drawn as the rounded card the web app uses.
private struct CategoryCard: View {
    let category: TPCategory
    let items: [TPItem]
    let pending: Set<String>
    let onToggle: (TPItem) -> Void

    @State private var collapsed = false

    private var checkedCount: Int { items.filter(\.checked).count }

    var body: some View {
        VStack(spacing: 0) {
            header

            if !collapsed {
                // Hairline between header and rows, matching the web card.
                Rectangle()
                    .fill(TPTheme.hairline.opacity(0.6))
                    .frame(height: 1)

                VStack(spacing: 0) {
                    ForEach(items, id: \.id) { item in
                        PackingRow(
                            item: item,
                            isPending: pending.contains(item.id),
                            onToggle: { onToggle(item) }
                        )
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .background(TPTheme.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(TPTheme.hairline.opacity(0.7), lineWidth: 1)
        )
    }

    private var header: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.18)) { collapsed.toggle() }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: collapsed ? "chevron.down" : "chevron.up")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TPTheme.textMuted)
                    .frame(width: 14)

                Text(category.icon ?? "📦")
                    .font(.system(size: 16))

                Text(category.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(TPTheme.textPrimary)

                Spacer(minLength: 8)

                Text("\(checkedCount)/\(items.count)")
                    .font(.system(size: 12))
                    .foregroundStyle(TPTheme.textMuted)
                    .monospacedDigit()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A single packing item, matching the web row.
private struct PackingRow: View {
    let item: TPItem
    let isPending: Bool
    let onToggle: () -> Void

    /// Matches Tailwind's emerald-500, used for the checkbox and the row tint
    /// in the web app. Not the system accent, which is blue and reads as a
    /// different product.
    private let emerald = Color(hex: 0x10b981)

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                checkbox

                if let icon = item.icon, !icon.isEmpty {
                    Text(icon).font(.system(size: 14))
                }

                Text(item.name)
                    .font(.system(size: 14))
                    .strikethrough(item.checked, color: TPTheme.textMuted)
                    .foregroundStyle(item.checked ? TPTheme.textMuted : Color(hex: 0xe4e4e7))

                Spacer(minLength: 8)

                // Quantity only shown when it says something a bare row would
                // not: "Passport x1" is noise, "Battery x4" is information.
                if item.quantity > 1 {
                    Text("x\(item.quantity)")
                        .font(.system(size: 12))
                        .foregroundStyle(TPTheme.textMuted)
                        .monospacedDigit()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(item.checked ? emerald.opacity(0.05) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isPending)
        .opacity(isPending ? 0.6 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.name)\(item.quantity > 1 ? ", quantity \(item.quantity)" : "")")
        .accessibilityValue(item.checked ? "Packed" : "Not packed")
        .accessibilityHint("Double tap to toggle")
    }

    /// A filled emerald box with a tick when packed, an empty outlined box when
    /// not. Drawn rather than using SF Symbols' checkmark.circle so it reads as
    /// the web app's square checkbox rather than an iOS toggle affordance.
    private var checkbox: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(item.checked ? emerald : Color.clear)
                .frame(width: 18, height: 18)

            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .stroke(item.checked ? emerald : TPTheme.hairline, lineWidth: 1.5)
                .frame(width: 18, height: 18)

            if item.checked {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
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
                .foregroundStyle(TPTheme.textMuted)

            Text(title)
                .font(.headline)
                .foregroundStyle(TPTheme.textPrimary)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(TPTheme.textSecondary)
                .multilineTextAlignment(.center)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .tint(TPTheme.primary)
                    .padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}
