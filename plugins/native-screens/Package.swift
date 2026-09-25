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
 * Platforms is pinned to .iOS(.v15) to match the app's deployment target. The
 * SwiftUI screen it presents uses only API available at 15; that constraint is
 * deliberate, because raising this floor would drop devices for a pilot feature.
 */
let package = Package(
    name: "NativeScreensPlugin",
    platforms: [.iOS(.v15)],
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
            path: "ios/Sources/NativeScreensPlugin"
        )
    ]
)
