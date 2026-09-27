import SwiftUI

/*
 * Bags and on-device packing suggestions for the native packing list.
 *
 * Kept in its own file because both sections are self-contained: they read the
 * shared model and render, and neither is reachable from the packing rows
 * except by the callbacks passed in. PackingListView.swift was already at the
 * size where another 400 lines of sections would have buried the list itself.
 *
 * Mirror rule for both: the web app is the reference. Labels, ordering,
 * gating and copy are copied from src/components/TripBags.tsx and
 * src/components/PackingSuggestions.tsx rather than re-invented, so the two
 * surfaces do not drift into describing the same feature differently.
 */

// MARK: - Bags

/// The bag kind vocabulary. Mirrors BAG_KINDS/BAG_KIND_LABELS in
/// src/lib/types.ts, and the CHECK constraint on bags.kind in src/lib/db.ts.
///
/// Hardcoded because the values are a database constraint, not a preference:
/// sending anything else fails the insert, so a typo here would be a runtime
/// error rather than a missing option.
enum BagKindOption: String, CaseIterable, Identifiable {
    case checked
    case carry_on
    case personal
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .checked: return "Checked"
        case .carry_on: return "Carry-on"
        case .personal: return "Personal item"
        case .other: return "Other"
        }
    }
}

/// The bag list that sits above the packing categories.
///
/// Above, not below, because a bag is the container the rows are sorted into:
/// an item's bag chip is only meaningful once bags exist, so the thing that
/// creates them has to come first. Same reasoning as the web tab.
struct BagSection: View {
    let tripId: String
    @ObservedObject var model: PackingListModel

    @State private var adding = false
    @State private var renaming: TPBag?
    @State private var deleting: TPBag?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "suitcase")
                    .font(.system(size: 12))
                    .foregroundStyle(TPTheme.textMuted)
                Text("BAGS")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(TPTheme.textMuted)

                let count = model.bags(for: tripId).count
                if count > 0 {
                    Text("\(count)")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(TPTheme.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(TPTheme.surface2)
                        .clipShape(Capsule())
                }

                Spacer()

                Button {
                    adding = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(TPTheme.textSecondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Add a bag")
            }

            let bags = model.bags(for: tripId)
            if bags.isEmpty {
                Text("No bags yet. Add one to sort items into what you're carrying.")
                    .font(.system(size: 12))
                    .foregroundStyle(TPTheme.textMuted)
                    .padding(.vertical, 2)
            } else {
                ForEach(bags) { bag in
                    bagRow(bag)
                }
            }
        }
        .padding(12)
        .background(TPTheme.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .sheet(isPresented: $adding) {
            BagEditorSheet(
                title: "Add a Bag",
                initialName: "",
                initialKind: .checked,
                showsKindPicker: true,
                isSaving: false,
                onSave: { name, kind in
                    await model.addBag(tripId: tripId, name: name, kind: kind.rawValue)
                },
                onCancel: { adding = false }
            )
        }
        .sheet(item: $renaming) { bag in
            BagEditorSheet(
                title: "Rename Bag",
                initialName: bag.name,
                initialKind: BagKindOption(rawValue: bag.kind) ?? .checked,
                showsKindPicker: false,
                isSaving: false,
                onSave: { name, _ in await model.renameBag(bag, name: name) },
                onCancel: { renaming = nil }
            )
        }
        .alert(
            "Delete this bag?",
            isPresented: Binding(
                get: { deleting != nil },
                set: { if !$0 { deleting = nil } }
            ),
            presenting: deleting
        ) { bag in
            Button("Delete \"\(bag.name)\"", role: .destructive) {
                let target = bag
                deleting = nil
                Task { await model.deleteBag(target) }
            }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: { bag in
            // Says the items survive, because that is the surprising part and
            // the thing a user would otherwise assume they were about to lose.
            let n = model.itemCount(for: bag)
            Text(
                n == 0
                    ? "The bag will be removed."
                    : "The \(n) item\(n == 1 ? "" : "s") in it will stay on your packing list, just without a bag."
            )
        }
    }

    private func bagRow(_ bag: TPBag) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "suitcase.fill")
                .font(.system(size: 11))
                .foregroundStyle(TPTheme.textMuted)

            VStack(alignment: .leading, spacing: 1) {
                Text(bag.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TPTheme.textPrimary)
                Text(BagKindOption(rawValue: bag.kind)?.label ?? bag.kind)
                    .font(.system(size: 11))
                    .foregroundStyle(TPTheme.textMuted)
            }

            Spacer()

            let n = model.itemCount(for: bag)
            Text("\(n) item\(n == 1 ? "" : "s")")
                .font(.system(size: 11))
                .foregroundStyle(TPTheme.textMuted)

            Button {
                renaming = bag
            } label: {
                Image(systemName: "pencil")
                    .font(.system(size: 11))
                    .foregroundStyle(TPTheme.textMuted)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Rename \(bag.name)")

            Button {
                deleting = bag
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 11))
                    .foregroundStyle(TPTheme.textMuted)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Delete \(bag.name)")
        }
        .padding(.vertical, 2)
    }
}

/// Add or rename a bag.
///
/// One sheet for both because the fields are identical and only the title and
/// the kind picker differ. A second near-identical sheet would be the kind of
/// duplication that drifts -- the two would slowly stop matching each other.
struct BagEditorSheet: View {
    let title: String
    let initialName: String
    let initialKind: BagKindOption
    let showsKindPicker: Bool
    let isSaving: Bool
    /// Returns true when the write landed, so the sheet knows to dismiss.
    let onSave: (String, BagKindOption) async -> Bool
    let onCancel: () -> Void

    @State private var name: String
    @State private var kind: BagKindOption
    @State private var saving = false
    @FocusState private var nameFocused: Bool

    init(
        title: String,
        initialName: String,
        initialKind: BagKindOption,
        showsKindPicker: Bool,
        isSaving: Bool,
        onSave: @escaping (String, BagKindOption) async -> Bool,
        onCancel: @escaping () -> Void
    ) {
        self.title = title
        self.initialName = initialName
        self.initialKind = initialKind
        self.showsKindPicker = showsKindPicker
        self.isSaving = isSaving
        self.onSave = onSave
        self.onCancel = onCancel
        _name = State(initialValue: initialName)
        _kind = State(initialValue: initialKind)
    }

    /// Trimmed, because " " is not a name and the server stores whatever it is
    /// given -- an all-whitespace bag would render as a blank row the user
    /// cannot identify or tap meaningfully.
    private var trimmed: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        // NavigationStack, not NavigationView. The target is iOS 17 now, so the
        // reason this used to be NavigationView (it being iOS 16+) is gone, and
        // NavigationView is deprecated. Dropping `.navigationViewStyle(.stack)`
        // is part of the same change: it only existed to stop NavigationView
        // presenting as a split view in a sheet, which NavigationStack never
        // does.
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .focused($nameFocused)
                }
                if showsKindPicker {
                    Section {
                        Picker("Type", selection: $kind) {
                            ForEach(BagKindOption.allCases) { option in
                                Text(option.label).tag(option)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            Task {
                                saving = true
                                let ok = await onSave(trimmed, kind)
                                saving = false
                                if ok { onCancel() }
                            }
                        }
                        .disabled(trimmed.isEmpty)
                    }
                }
            }
            .onAppear { nameFocused = true }
        }
    }
}

// MARK: - Suggestions

/// One suggestion the model proposed.
struct Suggestion: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let reason: String
}

/// The suggestion result, shaped like the JSON the model is asked for.
private struct SuggestionPayload: Decodable {
    struct Entry: Decodable {
        let name: String
        let reason: String?
    }
    let items: [Entry]
}

/// On-device packing suggestions, click-to-add only.
///
/// Never writes to the list on its own. The model proposes; the user disposes.
/// That is the same contract as the web component, and it matters more here
/// because a suggestion that silently appeared in the list would look like a
/// sync conflict rather than a suggestion.
struct SuggestionsSection: View {
    let tripId: String
    let destination: String
    let days: Int?
    let month: Int?
    @ObservedObject var model: PackingListModel

    @State private var suggestions: [Suggestion] = []
    @State private var generating = false
    @State private var message: String?
    @State private var generatedOnce = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12))
                    // Same accent as the button below, so the header and its
                    // action read as one AI affordance. Previously both header
                    // and button were muted grey, which was the reason neither
                    // stood out.
                    .foregroundStyle(TPTheme.ai)
                Text("SUGGESTIONS")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(TPTheme.textMuted)
                Spacer()
                if generating {
                    ProgressView().controlSize(.mini)
                } else {
                    // A filled, green, icon+label button -- this is the one
                    // ACTION in the section, and the web app also pairs the
                    // label with a Sparkles icon. The icon is what makes it
                    // read as "this is the AI feature" rather than as a
                    // generic submit, which the bare word "Suggest" did not.
                    Button {
                        Task { await generate() }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "wand.and.stars")
                                .font(.system(size: 11, weight: .semibold))
                            Text(generatedOnce ? "Regenerate" : "Suggest")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(TPTheme.surface0)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(TPTheme.ai)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    // Spoken as one control, and named for what it does rather
                    // than for the glyph, which VoiceOver would otherwise read
                    // as "wand and stars".
                    .accessibilityLabel(
                        generatedOnce ? "Regenerate suggestions" : "Suggest packing items"
                    )
                }
            }

            if let message {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(TPTheme.textMuted)
            } else if suggestions.isEmpty {
                Text("On-device suggestions based on where and when you're going.")
                    .font(.system(size: 12))
                    .foregroundStyle(TPTheme.textMuted)
            } else {
                ForEach(suggestions) { suggestion in
                    suggestionRow(suggestion)
                }
            }
        }
        .padding(12)
        .background(TPTheme.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func suggestionRow(_ suggestion: Suggestion) -> some View {
        // "Already in list" is computed from LIVE state, not from generate
        // time, because the list can change between the two -- another device,
        // or an earlier tap in this same session. Recomputing per render means
        // the chip cannot claim an item is addable after it has been added.
        let already = model.hasItem(named: suggestion.name, tripId: tripId)

        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(suggestion.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TPTheme.textPrimary)
                if !suggestion.reason.isEmpty {
                    Text(suggestion.reason)
                        .font(.system(size: 11))
                        .foregroundStyle(TPTheme.textMuted)
                        .lineLimit(2)
                }
            }
            Spacer()
            if already {
                Text("Already in list")
                    .font(.system(size: 11))
                    .foregroundStyle(TPTheme.textMuted)
            } else {
                Button {
                    Task { await add(suggestion) }
                } label: {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 16))
                        .foregroundStyle(TPTheme.textSecondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Add \(suggestion.name)")
            }
        }
        .padding(.vertical, 2)
    }

    private func generate() async {
        generating = true
        message = nil

        let report = await FoundationModelsBridge.availability()
        guard report.available else {
            message = report.message
            generating = false
            generatedOnce = true
            return
        }

        let prompt = Self.buildPrompt(
            destination: destination,
            days: days,
            month: month,
            existing: model.itemNames(for: tripId)
        )

        let raw = await FoundationModelsBridge.generateStructured(
            prompt: prompt,
            fields: ["name", "reason"]
        )

        guard let raw, let parsed = Self.parseSuggestions(raw.text) else {
            message = "Couldn't generate suggestions. Try again."
            generating = false
            generatedOnce = true
            return
        }

        suggestions = parsed
        if parsed.isEmpty { message = "No suggestions came back. Try again." }
        generating = false
        generatedOnce = true
    }

    private func add(_ suggestion: Suggestion) async {
        await model.addSuggestion(
            named: suggestion.name,
            tripId: tripId,
            categoryId: model.defaultCategoryId(for: tripId)
        )
        // Drop it from the visible list so the row collapses rather than
        // switching to "Already in list" and staying on screen.
        suggestions.removeAll { $0.id == suggestion.id }
    }

    // MARK: Pure helpers (testable without a view)

    private static let months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]

    /// Builds the on-device prompt.
    ///
    /// Mirrors buildPackingPrompt in src/lib/packingSuggestions.ts line for
    /// line. Two constraints are stated explicitly because the model otherwise
    /// ignores them: do not repeat what is already packed, and return JSON
    /// only. The existing-item list is capped because a long list pushes the
    /// format instruction out of the small context window -- the tail is
    /// dropped rather than the rule.
    static func buildPrompt(
        destination: String,
        days: Int?,
        month: Int?,
        existing: [String]
    ) -> String {
        var parts: [String] = []
        let dest = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        if !dest.isEmpty { parts.append(dest) }
        if let days, days > 0 {
            parts.append("\(days) day\(days == 1 ? "" : "s")")
        }
        if let month, month >= 1, month <= 12 {
            parts.append("in \(months[month - 1])")
        }
        let trip = parts.isEmpty ? "an unspecified trip" : parts.joined(separator: ", ")

        let seen = existing
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(40)

        var lines = [
            "Suggest \(kMaxSuggestions) things to pack for a trip to \(trip).",
            "Prefer specific, useful items over generic ones.",
            "Return JSON only, shaped exactly like: {\"items\":[{\"name\":\"...\",\"reason\":\"...\"}]}",
            "Include at most \(kMaxSuggestions) items.",
        ]

        if !seen.isEmpty {
            lines.append("Do not suggest any of these, already packed: \(seen.joined(separator: ", ")).")
        }

        return lines.joined(separator: "\n")
    }

    /// Parse the model's reply into suggestions.
    ///
    /// Tolerant on purpose. The model variously wraps JSON in a code fence or
    /// prefixes it with a sentence, so the outermost {...} span is extracted
    /// before parsing. A failure returns nil -- a malformed reply should cost
    /// the user a suggestion, not an error screen.
    static func parseSuggestions(_ raw: String) -> [Suggestion]? {
        guard !raw.isEmpty else { return nil }

        var candidate = raw
        if let fenceRange = raw.range(of: "```") {
            let afterFence = raw[fenceRange.upperBound...]
            if let endFence = afterFence.range(of: "```") {
                candidate = String(afterFence[..<endFence.lowerBound])
            }
        }

        guard let start = candidate.firstIndex(of: "{"),
              let end = candidate.lastIndex(of: "}"),
              start < end else { return nil }

        let json = String(candidate[start...end])
        guard let data = json.data(using: .utf8) else { return nil }

        guard let payload = try? JSONDecoder().decode(SuggestionPayload.self, from: data) else {
            return nil
        }

        return payload.items
            .map { entry in
                Suggestion(
                    name: entry.name.trimmingCharacters(in: .whitespacesAndNewlines),
                    reason: (entry.reason ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                )
            }
            .filter { !$0.name.isEmpty }
    }
}
