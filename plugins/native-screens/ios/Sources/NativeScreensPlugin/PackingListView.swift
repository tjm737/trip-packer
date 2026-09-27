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
                            onToggle: { item in Task { await model.toggle(item) } },
                            onEdit: { item in editingItem = item },
                            onDelete: { item in deletingItem = item }
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
    let onToggle: (TPItem) -> Void
    let onEdit: (TPItem) -> Void
    let onDelete: (TPItem) -> Void

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
                            onDelete: { onDelete(item) }
                        ) {
                            PackingRow(
                                item: item,
                                isPending: pending.contains(item.id),
                                isSwipedOpen: openRowId == item.id,
                                onToggle: { onToggle(item) }
                            )
                        }
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
        ZStack(alignment: .leading) {
            // The actions sit BEHIND the row and are uncovered by it moving,
            // rather than being laid out beside it. A `HStack` would push the
            // row narrower as the buttons appear, which looks like the list is
            // being squashed.
            actions

            content
                .background(TPTheme.surface1)
                .offset(x: offset)
                .gesture(dragGesture)
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
        // Only the buttons actually uncovered are visible, so the leading half
        // is clipped rather than peeking.
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
    let onToggle: () -> Void

    /// Matches Tailwind's emerald-500, used for the checkbox and the row tint
    /// in the web app. Not the system accent, which is blue and reads as a
    /// different product.
    private let emerald = Color(hex: 0x10b981)

    var body: some View {
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
