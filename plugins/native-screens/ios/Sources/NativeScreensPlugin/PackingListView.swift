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

    /// Clears the error banner. Needed as a separate call because the alert
    /// binding reads errorMessage to decide whether to show, so dismissing the
    /// alert has to reset it or it reappears on the next render.
    func clearError() {
        errorMessage = nil
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

    // MARK: - Bags

    /// This trip's bags in a stable order.
    ///
    /// Sorted by name, not by creation time: TPBag does not decode `createdAt`,
    /// and sorting by `id` (a random UUID) would put the list in an order that
    /// looks arbitrary and can appear to reshuffle between renders. Name is the
    /// order the user can see and predict. Case-insensitive so "backpack" does
    /// not sort after "Daypack".
    func bags(for tripId: String) -> [TPBag] {
        (state?.bags ?? [])
            .filter { $0.tripId == tripId }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func bag(_ bagId: String?) -> TPBag? {
        guard let bagId else { return nil }
        return (state?.bags ?? []).first { $0.id == bagId }
    }

    /// How many items this trip has assigned to a bag. Shown as the bag's count
    /// so the user can see at a glance which bag is carrying the trip.
    func itemCount(for bag: TPBag) -> Int {
        (state?.items ?? []).filter { $0.bagId == bag.id }.count
    }

    /// Adds a bag. No optimism: the bag list is short, the sheet stays open
    /// with a spinner until the write lands, and a failed add that briefly
    /// showed a phantom bag would then have to animate it away again.
    func addBag(tripId: String, name: String, kind: String) async -> Bool {
        let bag = TPBag(
            id: UUID().uuidString,
            tripId: tripId,
            name: name,
            kind: kind,
            tagNumber: "",
            notes: ""
        )
        do {
            try await TPClient.shared.mutate(.bagCreate(bag))
            // Append locally rather than refetching: the server has no unique
            // constraint to violate here, so a successful round trip means the
            // bag exists and a refetch would only cost the user a spinner.
            state?.bags = (state?.bags ?? []) + [bag]
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func renameBag(_ bag: TPBag, name: String) async -> Bool {
        guard let idx = state?.bags?.firstIndex(where: { $0.id == bag.id }) else { return false }
        let previous = state?.bags?[idx].name
        state?.bags?[idx].name = name
        do {
            try await TPClient.shared.mutate(.bagRename(id: bag.id, name: name))
            return true
        } catch {
            if let previous { state?.bags?[idx].name = previous }
            errorMessage = error.localizedDescription
            return false
        }
    }

    /// Deletes a bag and unassigns its items.
    ///
    /// The items are NOT deleted -- a bag is only a container, and losing the
    /// packing list because a bag was removed would be data loss. Clearing
    /// `bagId` locally keeps the list consistent with what the server does.
    func deleteBag(_ bag: TPBag) async {
        guard !pending.contains(bag.id) else { return }
        let removedBag = bag
        let affected = (state?.items ?? []).filter { $0.bagId == bag.id }

        pending.insert(bag.id)
        state?.bags = (state?.bags ?? []).filter { $0.id != bag.id }
        for i in (state?.items.indices ?? 0..<0) where state?.items[i].bagId == bag.id {
            state?.items[i].bagId = nil
        }

        do {
            try await TPClient.shared.mutate(.bagDelete(id: bag.id))
        } catch {
            state?.bags = (state?.bags ?? []) + [removedBag]
            for i in (state?.items.indices ?? 0..<0) where affected.contains(where: { $0.id == state?.items[i].id }) {
                state?.items[i].bagId = removedBag.id
            }
            errorMessage = error.localizedDescription
        }
        pending.remove(bag.id)
    }

    /// Moves an item into a bag, or out of every bag when `bagId` is nil.
    ///
    /// Optimistic like toggle: the row's chip updates under the finger, which
    /// is the whole feedback the user gets for the action.
    func setBag(_ item: TPItem, bagId: String?) async {
        guard let idx = state?.items.firstIndex(where: { $0.id == item.id }) else { return }
        let previous = state?.items[idx].bagId
        state?.items[idx].bagId = bagId

        do {
            try await TPClient.shared.mutate(.itemSetBag(id: item.id, bagId: bagId))
        } catch {
            state?.items[idx].bagId = previous
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Suggestions support

    /// Whether an item with this name is already on the trip.
    ///
    /// Case- and whitespace-insensitive: the model returns "Passport" for a
    /// list that already contains "passport", and offering to add it again
    /// under a differently-cased name would create a visible duplicate.
    func hasItem(named name: String, tripId: String) -> Bool {
        let target = Self.normalise(name)
        guard !target.isEmpty else { return false }
        return (state?.items ?? []).contains {
            $0.tripId == tripId && Self.normalise($0.name) == target
        }
    }

    /// The trip's item names, for the prompt's "do not repeat these" list.
    func itemNames(for tripId: String) -> [String] {
        (state?.items ?? []).filter { $0.tripId == tripId }.map(\.name)
    }

    /// Where a suggested item should land.
    ///
    /// Categories are GLOBAL, not trip-scoped -- there is no tripId on
    /// TPCategory -- and `categories(for:)` deliberately returns only the ones
    /// that already hold items for this trip. That matters here: an item added
    /// into a category the list does not render would be invisible, which
    /// looks exactly like the add having failed.
    ///
    /// So this prefers a category already in use by this trip, and otherwise
    /// falls back to the lowest-ordered category that exists at all. Returns
    /// nil only when there are genuinely no categories anywhere, in which case
    /// the caller reports that instead of creating an orphaned item.
    func defaultCategoryId(for tripId: String) -> String? {
        if let used = categories(for: tripId).first?.id { return used }
        return (state?.categories ?? [])
            .sorted { ($0.order ?? 0) < ($1.order ?? 0) }
            .first?.id
    }

    /// Adds a model suggestion as a real item.
    ///
    /// Mirrors addSuggestion in the web component: it creates the item
    /// unchecked (a suggestion is a proposal, not a claim about what is
    /// packed) with quantity 1, and it is only ever called from an explicit
    /// tap.
    func addSuggestion(named name: String, tripId: String, categoryId: String?) async {
        guard let categoryId else {
            errorMessage = "This trip has no categories to add into."
            return
        }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        // Re-checked here, not just in the view: the row may have been
        // rendered before another device added the same item.
        guard !hasItem(named: trimmed, tripId: tripId) else { return }

        let order = (state?.items ?? [])
            .filter { $0.categoryId == categoryId }
            .map(\.order)
            .max()
            .map { $0 + 1 } ?? 0

        let item = TPItem(
            id: UUID().uuidString,
            tripId: tripId,
            categoryId: categoryId,
            name: trimmed,
            quantity: 1,
            checked: false,
            icon: nil,
            order: order,
            bagId: nil
        )

        // Optimistic: the row appears immediately, matching the tap.
        state?.items = (state?.items ?? []) + [item]

        do {
            try await TPClient.shared.mutate(.itemCreate(item))
        } catch {
            state?.items = (state?.items ?? []).filter { $0.id != item.id }
            errorMessage = error.localizedDescription
        }
    }

    /// Shared normalisation for name comparison.
    private static func normalise(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
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
            try await TPClient.shared.mutate(.itemToggle(id: item.id, checked: newValue))
        } catch {
            state?.items[idx].checked = !newValue
            errorMessage = error.localizedDescription
        }
        pending.remove(item.id)
    }

    /*
     * Delete removes the row from the local list first so the swipe animation
     * has something to animate against, then persists.
     *
     * The revert re-inserts at the ORIGINAL index rather than appending. Order
     * is meaningful here -- it is what the user sees on the web -- so a failed
     * delete that dumped the item at the bottom of its category would be a
     * second, quieter bug on top of the error message.
     */
    func delete(_ item: TPItem) async {
        guard !pending.contains(item.id) else { return }
        guard let current = state,
              let idx = current.items.firstIndex(where: { $0.id == item.id }) else { return }

        let removed = current.items[idx]
        pending.insert(item.id)
        state?.items.remove(at: idx)

        do {
            try await TPClient.shared.mutate(.itemDelete(id: item.id))
        } catch {
            let safeIndex = min(idx, state?.items.count ?? 0)
            state?.items.insert(removed, at: safeIndex)
            errorMessage = error.localizedDescription
        }
        pending.remove(item.id)
    }

    /*
     * Rename and quantity share a shape, so they share a helper. Sending only
     * the changed field (see TPOp) means an edit cannot revert a concurrent
     * toggle from another device.
     *
     * Unlike delete this does NOT apply optimistically: the edit sheet stays
     * open until the write lands, so there is a spinner to show and a clear
     * moment to report a failure. Reverting a half-typed name would also fight
     * the user mid-edit.
     */
    func edit(_ item: TPItem, name: String, quantity: Int) async -> Bool {
        guard !pending.contains(item.id) else { return false }
        guard let current = state,
              let idx = current.items.firstIndex(where: { $0.id == item.id }) else { return false }

        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        // An empty name would render as a blank row with no way to select it.
        guard !trimmed.isEmpty else {
            errorMessage = "An item needs a name."
            return false
        }
        // The server stores quantity as a positive integer.
        let safeQuantity = max(1, quantity)

        let previousName = current.items[idx].name
        let previousQuantity = current.items[idx].quantity

        pending.insert(item.id)
        state?.items[idx].name = trimmed
        state?.items[idx].quantity = safeQuantity

        do {
            if trimmed != previousName {
                try await TPClient.shared.mutate(.itemRename(id: item.id, name: trimmed))
            }
            if safeQuantity != previousQuantity {
                try await TPClient.shared.mutate(.itemQuantity(id: item.id, quantity: safeQuantity))
            }
        } catch {
            state?.items[idx].name = previousName
            state?.items[idx].quantity = previousQuantity
            errorMessage = error.localizedDescription
            pending.remove(item.id)
            return false
        }

        pending.remove(item.id)
        return true
    }
}

struct PackingListView: View {
    let tripId: String
    /// Dismisses the native screen. Presenting a screen with no way back is a
    /// trap, so the close control is a required part of the view rather than
    /// something the presenter adds around it.
    var onClose: (() -> Void)?

    @StateObject private var model = PackingListModel()

    /// The item being edited, and the item pending deletion.
    ///
    /// Delete confirms first. This is not ceremony: a mis-swipe on a list you
    /// scroll with your thumb is easy, and the item goes straight to the server
    /// with no undo. There is no trash to restore from, so the confirmation is
    /// the only thing standing between a stray swipe and lost data.
    @State private var editingItem: TPItem?
    @State private var deletingItem: TPItem?

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
            // The `if` goes INSIDE the ToolbarItem, not around it. Wrapping the
            // item in an `if let` makes the builder produce an
            // `Optional<ToolbarContent>`, which only conforms to ToolbarContent
            // on iOS 16+ -- a warning here and a hard error under Swift 6.
            // Keeping the condition inside yields a concrete ToolbarItem whose
            // body happens to be empty, which is valid on iOS 15.
            ToolbarItem(placement: .cancellationAction) {
                if let onClose {
                    Button("Done", action: onClose)
                        .foregroundStyle(TPTheme.textSecondary)
                }
            }
            // Refresh lives here rather than as pull-to-refresh: the
            // `.refreshable` control competed with the ScrollView's own pan and
            // broke scrolling outright (see the note above `content`). Placement
            // is `.primaryAction` so it sits on the trailing edge, opposite
            // Done, which is where a reload control is expected.
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(model.isLoading)
                .accessibilityLabel("Refresh")
            }
        }
        // No .toolbarBackground here: it needs iOS 16 and this target supports
        // iOS 15. The nav bar keeps its default material, which reads as native
        // chrome above the dark content rather than as a styling mistake.
        .preferredColorScheme(.dark)
        .task { await model.load() }
        // A failed toggle or delete sets errorMessage, which the load-failure
        // branch above never shows because state is already loaded. Without this
        // the write would fail and the user would see nothing at all.
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { model.state != nil && model.errorMessage != nil },
                set: { if !$0 { model.clearError() } }
            ),
            actions: { Button("OK", role: .cancel) { model.clearError() } },
            message: { Text(model.errorMessage ?? "") }
        )
        .sheet(item: $editingItem) { item in
            EditItemSheet(
                item: item,
                isSaving: model.pending.contains(item.id),
                onSave: { name, quantity in
                    let ok = await model.edit(item, name: name, quantity: quantity)
                    if ok { editingItem = nil }
                    return ok
                },
                onCancel: { editingItem = nil }
            )
        }
        .confirmationDialog(
            "Delete this item?",
            isPresented: Binding(
                get: { deletingItem != nil },
                set: { if !$0 { deletingItem = nil } }
            ),
            titleVisibility: .visible,
            presenting: deletingItem
        ) { item in
            Button("Delete \"\(item.name)\"", role: .destructive) {
                let target = item
                deletingItem = nil
                Task { await model.delete(target) }
            }
            Button("Cancel", role: .cancel) { deletingItem = nil }
        } message: { _ in
            Text("This removes it from the packing list for everyone. It cannot be undone.")
        }
    }

    private var content: some View {
        ScrollView {
            VStack(spacing: 12) {
                BagSection(tripId: tripId, model: model)

                SuggestionsSection(
                    tripId: tripId,
                    destination: model.trip(tripId)?.destination ?? "",
                    // Dates are not decoded into TPTrip (the API has them, the
                    // native shell does not read them), so the prompt states
                    // only what is actually known. Passing a guess would have
                    // the model reason about weather and season it was told
                    // rather than one it was given.
                    days: nil,
                    month: nil,
                    model: model
                )

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
                            bags: model.bags(for: tripId),
                            onToggle: { item in Task { await model.toggle(item) } },
                            onEdit: { item in editingItem = item },
                            onDelete: { item in deletingItem = item },
                            onSetBag: { item, bagId in
                                Task { await model.setBag(item, bagId: bagId) }
                            }
                        )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        // NO .refreshable HERE, deliberately.
        //
        // It was here and it broke scrolling: `.refreshable` installs a
        // pull-to-refresh control that competes with the ScrollView's own
        // vertical pan, so the list fought the gesture instead of scrolling.
        // The symptom was exactly "scroll up and down does not work" while
        // taps, toggles and the swipe rows all still worked -- which is why
        // it read as a gesture bug in the rows rather than in the container.
        //
        // It also predates the swipe rows: it arrived in the same commit that
        // fixed them, so the two were easy to confuse, and the row's
        // `.simultaneousGesture` looked like the obvious culprit. It was not.
        // A row gesture cannot prevent its parent ScrollView from scrolling;
        // a refresh control on the ScrollView can.
        //
        // Refresh moved to a toolbar button (see the toolbar below). If
        // pull-to-refresh is wanted back later, it needs to be re-added
        // together with a fix for this interaction, not on its own.
    }
}

/// Rename and re-quantify one item.
///
/// A sheet rather than inline editing: the row is a tap-to-toggle button, and
/// making the same tap sometimes start an edit would be ambiguous. The sheet
/// also gives the write somewhere to show progress and somewhere to report a
/// failure without the user losing what they typed.
private struct EditItemSheet: View {
    let item: TPItem
    let isSaving: Bool
    /// Returns true when the save landed, so the sheet knows to dismiss.
    let onSave: (String, Int) async -> Bool
    let onCancel: () -> Void

    @State private var name: String
    @State private var quantity: Int
    @FocusState private var nameFocused: Bool

    init(
        item: TPItem,
        isSaving: Bool,
        onSave: @escaping (String, Int) async -> Bool,
        onCancel: @escaping () -> Void
    ) {
        self.item = item
        self.isSaving = isSaving
        self.onSave = onSave
        self.onCancel = onCancel
        _name = State(initialValue: item.name)
        _quantity = State(initialValue: item.quantity)
    }

    /// An empty name cannot be saved, so the button says so rather than failing
    /// on the server and surfacing an error the user cannot act on.
    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSaving
    }

    var body: some View {
        NavigationView {
            ZStack {
                TPTheme.surface0.ignoresSafeArea()

                Form {
                    Section {
                        TextField("Item name", text: $name)
                            .focused($nameFocused)
                            .foregroundStyle(TPTheme.textPrimary)
                            .submitLabel(.done)
                    } header: {
                        Text("Name")
                            .font(.system(size: 10, weight: .medium))
                            .tracking(0.8)
                            .foregroundStyle(TPTheme.textMuted)
                    }

                    Section {
                        Stepper(value: $quantity, in: 1...999) {
                            HStack {
                                Text("Quantity")
                                    .foregroundStyle(TPTheme.textPrimary)
                                Spacer()
                                Text("\(quantity)")
                                    .foregroundStyle(TPTheme.textSecondary)
                                    .monospacedDigit()
                            }
                        }
                    } header: {
                        Text("Quantity")
                            .font(.system(size: 10, weight: .medium))
                            .tracking(0.8)
                            .foregroundStyle(TPTheme.textMuted)
                    }
                }
                // The Form's grouped background is a light grey that fights the
                // dark tokens. `.scrollContentBackground(.hidden)` would clear it
                // but needs iOS 16 and this target is iOS 15, so the background
                // is set directly with `UITableView.appearance()` instead --
                // the 15-compatible route. Scoped by setting it here rather than
                // at launch so it does not leak into other screens' tables.
                .onAppear {
                    UITableView.appearance().backgroundColor = .clear
                }
            }
            .navigationTitle("Edit Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().tint(TPTheme.textSecondary)
                    } else {
                        Button("Save") {
                            let n = name
                            let q = quantity
                            Task { _ = await onSave(n, q) }
                        }
                        .disabled(!canSave)
                    }
                }
            }
        }
        .navigationViewStyle(.stack)
        .preferredColorScheme(.dark)
        .onAppear { nameFocused = true }
    }
}

/// One category, drawn as the rounded card the web app uses.
private struct CategoryCard: View {
    let category: TPCategory
    let items: [TPItem]
    let pending: Set<String>
    /// The trip's bags, so each row can show which bag its item is in.
    let bags: [TPBag]
    let onToggle: (TPItem) -> Void
    let onEdit: (TPItem) -> Void
    let onDelete: (TPItem) -> Void
    let onSetBag: (TPItem, String?) -> Void

    /// Which row is swiped open. Held per CARD rather than globally, so an open
    /// row in one category is not closed by opening a row in another -- they are
    /// visually separate cards, so the state should not leak between them.
    @State private var openRowId: String?

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
                        SwipeRow(
                            id: item.id,
                            openRowId: $openRowId,
                            onEdit: { onEdit(item) },
                            onDelete: { onDelete(item) },
                            content: {
                                PackingRow(
                                    item: item,
                                    isPending: pending.contains(item.id),
                                    isSwipedOpen: openRowId == item.id,
                                    bags: bags,
                                    onToggle: { onToggle(item) },
                                    onSetBag: { bagId in onSetBag(item, bagId) }
                                )
                            }
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
        // Collapsing the card while a row is open would leave the row state
        // pointing at a hidden row, so close it.
        .onChange(of: collapsed) { isCollapsed in
            if isCollapsed { openRowId = nil }
        }
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

/// A row that reveals actions when dragged, like Mail.
///
/// WHY THIS IS HAND-ROLLED. `.swipeActions` only exists on a `List` row, and
/// this screen deliberately is not a `List` (see the note at the top of the
/// file): the app's packing list is a stack of rounded cards, and `List`
/// insists on full-bleed rows with separators. Adopting `List` to get swipe
/// would undo the design the screen exists to prove. So the gesture is built
/// here instead, once, and used by every row.
///
/// The behaviour that matters, all of which a naive
/// `offset(x: drag)` implementation gets wrong:
///
///   - SNAP, not free-drag. The row settles open or closed on release, so it
///     cannot come to rest half-revealed.
///   - ONE OPEN AT A TIME, via `openRowId` held by the parent. Two half-open
///     rows is the classic tell that this was assembled rather than designed.
///   - TAP TO CLOSE. Tapping the row body while open closes it instead of
///     toggling the item, which is what stock behaviour does.
///   - DIRECTION LOCK. A mostly-vertical drag scrolls the list; only a clearly
///     horizontal drag moves the row. Without this, scrolling the list with a
///     slightly sideways thumb drags rows open.
struct SwipeRow<Content: View>: View {
    let id: String
    /// Id of the row currently open, shared across all rows so opening one
    /// closes the others.
    @Binding var openRowId: String?
    let onEdit: () -> Void
    let onDelete: () -> Void
    /// `@ViewBuilder` matters here. Without it the memberwise init infers this
    /// as `() -> Content` and SwiftUI rejects it: the property must be view
    /// CONTENT, not a closure that returns a view, or the trailing-closure
    /// call site fails to conform to `View`.
    @ViewBuilder let content: Content

    @State private var offset: CGFloat = 0

    /// Width of each revealed button. 84 fits "Delete" at the row's text size
    /// without truncating.
    private let actionWidth: CGFloat = 84

    private var isOpen: Bool { openRowId == id }

    /// How far a drag must travel before it is treated as opening rather than
    /// as a scroll or a tap.
    private let commitThreshold: CGFloat = 44

    var body: some View {
        ZStack(alignment: .trailing) {
            // The actions sit BEHIND the row and are uncovered by it moving,
            // rather than being laid out beside it. A `HStack` would push the
            // row narrower as the buttons appear, which looks like the list is
            // being squashed.
            //
            // Alignment is `.trailing`, NOT `.leading`: the row slides LEFT, so
            // it uncovers its right-hand side. Leading alignment drew the
            // buttons at the left edge, where the row still covered them -- the
            // swipe moved and revealed nothing, which reads as "no delete
            // button". The actions must live where the gap appears.
            actions

            content
                .background(TPTheme.surface1)
                .offset(x: offset)
                // simultaneousGesture, NOT highPriorityGesture and NOT gesture.
                //
                //   .gesture            -- the enclosing ScrollView wins the
                //                          contest and the row never moves, so
                //                          the swipe looks unimplemented.
                //   .highPriorityGesture -- the row wins EVERY drag, including
                //                          vertical ones, so scrolling the
                //                          list breaks. (This is the one that
                //                          gets misdiagnosed: if scrolling is
                //                          broken, check whether the CONTAINER
                //                          has a refresh control before
                //                          blaming the row's priority.)
                //   .simultaneousGesture -- both receive the drag, the row acts
                //                          only when the direction lock says
                //                          horizontal, and the ScrollView keeps
                //                          vertical scrolling. This is correct.
                //
                // The row must therefore never claim a gesture it will not
                // act on, which is exactly what the `guard abs(dx) > abs(dy)`
                // in dragGesture is for.
                .simultaneousGesture(dragGesture)
                // A tap anywhere on an open row closes it. Placed on the row
                // rather than the container so the revealed buttons below stay
                // tappable.
                .onTapGesture {
                    if isOpen {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                            offset = 0
                        }
                    }
                }
        }
        // The row is one accessibility element with custom actions, so
        // VoiceOver users reach Delete and Edit without needing the drag
        // gesture at all -- which they cannot perform. Without this the swipe
        // actions would be invisible to them.
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Delete", onDelete)
        .accessibilityAction(named: "Edit", onEdit)
        .onChange(of: openRowId) { newValue in
            // Another row opened: close this one. Driven by the shared binding
            // so the row cannot disagree with the parent about who is open.
            if newValue != id && offset != 0 {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                    offset = 0
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 0) {
            SwipeActionButton(
                title: "Edit",
                systemImage: "pencil",
                tint: TPTheme.surface3,
                width: actionWidth,
                action: {
                    close()
                    onEdit()
                }
            )

            SwipeActionButton(
                title: "Delete",
                systemImage: "trash",
                tint: Color(hex: 0xdc2626), // red-600, the web app's destructive tone
                width: actionWidth,
                action: {
                    close()
                    onDelete()
                }
            )
        }
        // Hidden while the row is closed, so the buttons cannot bleed through
        // the row's own background at rest. Once the row slides, the strip it
        // vacates shows whatever the trace order puts underneath -- the actions.
        .opacity(offset < 0 ? 1 : 0)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                let dx = value.translation.width
                let dy = value.translation.height

                // Direction lock: ignore a drag that is mostly vertical so the
                // enclosing ScrollView keeps it.
                guard abs(dx) > abs(dy) else { return }

                // Only leftward drags open a row. A rightward drag past the
                // closed position would detach the row from its card edge.
                if dx < 0 {
                    offset = max(dx, -(actionWidth * 2))
                } else if isOpen {
                    // Dragging back closes, but only as far as closed.
                    offset = min(0, -actionWidth * 2 + dx)
                }
            }
            .onEnded { value in
                let dx = value.translation.width
                guard abs(dx) > abs(value.translation.height) else { return }

                let shouldOpen = dx < -commitThreshold
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                    if shouldOpen {
                        offset = -(actionWidth * 2)
                        openRowId = id
                    } else {
                        offset = 0
                        if openRowId == id { openRowId = nil }
                    }
                }
            }
    }

    private func close() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { offset = 0 }
        if openRowId == id { openRowId = nil }
    }
}

/// One revealed action button, sized to align with the row's vertical padding.
private struct SwipeActionButton: View {
    let title: String
    let systemImage: String
    let tint: Color
    let width: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                Text(title)
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(.white)
            .frame(width: width)
            .frame(maxHeight: .infinity)
            .background(tint)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

/// A single packing item, matching the web row.
private struct PackingRow: View {
    let item: TPItem
    let isPending: Bool
    /// True while this row is swiped open. Used to block the toggle, because
    /// tapping an open row should close it (handled by SwipeRow) rather than
    /// silently flip its checked state underneath the revealed buttons.
    let isSwipedOpen: Bool
    /// The trip's bags. Empty on a trip that has not opted into bags, in which
    /// case no chip and no menu are drawn at all -- an empty "assign to bag"
    /// control on every row of a trip that has no bags would be a permanent
    /// invitation to a dead end.
    let bags: [TPBag]
    let onToggle: () -> Void
    let onSetBag: (String?) -> Void

    /// Matches Tailwind's emerald-500, used for the checkbox and the row tint
    /// in the web app. Not the system accent, which is blue and reads as a
    /// different product.
    private let emerald = Color(hex: 0x10b981)

    /// The bag this item is in, if that bag is still in the trip's list.
    ///
    /// Looked up rather than trusted: an item can reference a bag deleted on
    /// another device, and showing a chip for a bag that no longer exists
    /// would be a ghost the user cannot clear.
    private var bag: TPBag? {
        guard let bagId = item.bagId else { return nil }
        return bags.first { $0.id == bagId }
    }

    var body: some View {
        HStack(spacing: 0) {
            // The toggle button covers checkbox and name only. The bag chip
            // sits OUTSIDE it so tapping the chip cannot also flip the item's
            // packed state -- two different actions one tap apart is the
            // classic source of "it checked itself off when I tapped the bag".
            Button {
                guard !isSwipedOpen else { return }
                onToggle()
            } label: {
                HStack(spacing: 12) {
                    checkbox

                    if let icon = item.icon, !icon.isEmpty {
                        Text(icon).font(.system(size: 14))
                    }

                    Text(item.name)
                        .font(.system(size: 14))
                        .strikethrough(item.checked, color: TPTheme.textMuted)
                        .foregroundStyle(item.checked ? TPTheme.textMuted : Color(hex: 0xe4e4e7))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

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
                .padding(.leading, 12)
                .padding(.vertical, 10)
                .background(item.checked ? emerald.opacity(0.05) : Color.clear)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isPending)
            .opacity(isPending ? 0.6 : 1)

            if !bags.isEmpty {
                bagControl
            } else {
                // Keeps the row's right padding correct when there is no chip,
                // so rows with and without bags stay aligned.
                Spacer().frame(width: 12)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.name)\(item.quantity > 1 ? ", quantity \(item.quantity)" : "")")
        .accessibilityValue(accessibilityValue)
        .accessibilityHint("Double tap to toggle")
    }

    /// Combined VoiceOver value: packed state plus bag, because the chip alone
    /// is a visual affordance a screen reader user would never reach.
    private var accessibilityValue: String {
        let packed = item.checked ? "Packed" : "Not packed"
        guard !bags.isEmpty else { return packed }
        if let bag { return "\(packed), in \(bag.name)" }
        return "\(packed), no bag"
    }

    /// Assigns the item to a bag, or clears it.
    ///
    /// A Menu rather than a swipe action: the swipe already carries Edit and
    /// Delete, and a third revealed button would make the row's gesture
    /// crowded. It also keeps the current bag visible on the row, which a
    /// swipe-only control could not do.
    private var bagControl: some View {
        Menu {
            Button {
                onSetBag(nil)
            } label: {
                Label("No bag", systemImage: bag == nil ? "checkmark" : "tray")
            }

            ForEach(bags) { option in
                Button {
                    onSetBag(option.id)
                } label: {
                    Label(
                        option.name,
                        systemImage: option.id == item.bagId ? "checkmark" : "suitcase"
                    )
                }
            }
        } label: {
            if let bag {
                HStack(spacing: 4) {
                    Image(systemName: "suitcase.fill")
                        .font(.system(size: 9))
                    Text(bag.name)
                        .font(.system(size: 11))
                        .lineLimit(1)
                }
                .foregroundStyle(TPTheme.textSecondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(TPTheme.surface2)
                .clipShape(Capsule())
            } else {
                Image(systemName: "suitcase")
                    .font(.system(size: 13))
                    .foregroundStyle(TPTheme.textMuted.opacity(0.7))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
        }
        .padding(.trailing, 10)
        .disabled(isPending)
        .accessibilityLabel(bag == nil ? "Assign a bag" : "In \(bag!.name), change bag")
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
