import SwiftUI

/*
 * Design tokens mirrored from the web app's globals.css.
 *
 * The first version of this screen used stock SwiftUI: a system List, system
 * separators, .accentColor, and default section headers. It looked like a
 * different product than the web app it mirrors -- correctly, because it was
 * styled for iOS instead of for this app. These tokens are the fix.
 *
 * Values are duplicated from the CSS custom properties on purpose. There is no
 * shared build step between the web bundle and the Swift package, so the choice
 * is duplication or a generated file; duplication is honest and visible, and
 * the risk is drift, which is noted here so a change to one prompts the other.
 *
 * Source of truth: src/app/globals.css
 *   --surface-0  #0a0a0a   page background
 *   --surface-1  #1f1f1f   cards, sidebar panels
 *   --surface-2  #2a2a2a   nested cards, inputs
 *   --surface-3  #383838   popovers, hover states
 *   --primary    #406655   deeper CTA tone; white text clears 6.5:1
 */
enum TPTheme {
    static let surface0 = Color(hex: 0x0a0a0a)
    static let surface1 = Color(hex: 0x1f1f1f)
    static let surface2 = Color(hex: 0x2a2a2a)
    static let surface3 = Color(hex: 0x383838)
    static let primary = Color(hex: 0x406655)

    /// Tailwind `emerald-400` — the green the WEB app already uses for its AI
    /// affordances (see `PackingSuggestions.tsx`, which tints its spinner
    /// `text-emerald-400`). Reusing it here keeps the native AI button anchored
    /// to an existing brand colour instead of inventing a second green.
    ///
    /// Distinct from `primary` (0x406655), which is a dark forest green chosen
    /// for tinting and large fills. Both are legible in their intended pairing
    /// -- white on `primary` measures 6.46:1 and dark-on-`ai` measures 10.30:1
    /// -- so this is not a contrast decision, it is a hue/brightness one: the
    /// brighter emerald is what makes a small control read as "the AI action"
    /// against a dark card, and it matches the accent the web already uses.
    static let ai = Color(hex: 0x34d399)

    /// zinc-400 / zinc-500 / zinc-700 equivalents, for text and hairlines.
    static let textPrimary = Color(hex: 0xfafafa)
    static let textSecondary = Color(hex: 0xa1a1aa)
    static let textMuted = Color(hex: 0x71717a)
    static let hairline = Color(hex: 0x3f3f46)
}

extension Color {
    /// Builds a colour from a 0xRRGGBB literal so the tokens above can be
    /// written in the same order as the CSS they mirror.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
