// swift-tools-version: 5.9
import PackageDescription

/*
 * Local Swift package for the NativeScreens Capacitor plugin.
 *
 * Why this is an SPM package and not a file in the App target, which is where
 * it was first written: Capacitor's CapacitorBridge.registerPlugins() reads
 * `capacitor.config.json` from the bundle and registers ONLY the classes listed
 * in its `packageClassList`, which `cap sync` populates from the packages
 * declared in Package.swift. An app-target class is never scanned, so a plugin
 * living there compiles, ships, and is never registered -- the bridge call
 * fails at runtime with "not implemented" while the build stays green. Moving
 * it here is what makes the class list include it.
 *
 * The layout mirrors the official plugins and foundation-models exactly --
 * `ios/Sources/<Name>` with a `Package.swift` at the package root pointing into
 * it -- so `cap sync ios` discovers it the same way.
 *
 * Platforms is pinned to .iOS(.v17) to match the app's deployment target.
 *
 * That target was raised from .v15 deliberately: 15 was never a decision, it
 * was the Capacitor scaffold default, and it was costing a pile of
 * deprecated-API workarounds (NavigationView instead of NavigationStack, a
 * hand-rolled empty state instead of ContentUnavailableView, no way to style
 * the nav bar). 17 covers the devices actually in use and removes that debt.
 */
let package = Package(
    name: "NativeScreensPlugin",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "NativeScreensPlugin",
            targets: ["NativeScreensPlugin"])
    ],
    dependencies: [
        .package(
            url: "https://github.com/ionic-team/capacitor-swift-pm.git",
            from: "8.0.0"
        )
    ],
    targets: [
        .target(
            name: "NativeScreensPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
            ],
            path: "ios/Sources/NativeScreensPlugin",
            linkerSettings: [
                // FoundationModelsBridge.swift calls LanguageModelSession
                // directly for on-device packing suggestions. Import alone
                // compiles but does not link, so without this the native
                // suggestions path fails at runtime while the build stays
                // green. .weak because the framework is iOS 26+ only.
                .linkedFramework("FoundationModels", .when(platforms: [.iOS]))
            ]
        )
    ]
)
